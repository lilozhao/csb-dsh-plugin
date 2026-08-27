// @csb/dsh-plugin · host 侧 glue plugin（M4: 全家桶 —— 文档分类 + skills 注册 + 服务控制）
//
// 端点:
//   csb.status        → 状态总览(AID/握手/注册表/LLM)
//   csb.docs.list     → 文档索引(protocol/charter/memory/aep 四分类)
//   csb.docs.get      → 读取单个文档(section + file)
//   csb.verify        → 自检(6 条,含 csb-security AID 签名校验)
//   csb.service.list  → 服务状态(3100 server_v5 / 3110 aep)
//   csb.service.start → 启动 A2A server(调 start-ruozhuo-a2a.sh,独立进程)
//   csb.service.stop  → 停止 A2A server
//   csb.memory.status → csb-memory 数据概览
//
// 设计原则: 服务独立进程(web 重启不拖垮 A2A) · Secret 只读环境变量 · authority=loopback

import { readFileSync, readdirSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const name = 'csb-host';
export const inject = ['connection', 'webServer'];

const CSB_RPC_CHANNEL = '/csb';
export const CSB_ENDPOINTS = Object.freeze({
  status: 'csb.status',
  docsList: 'csb.docs.list',
  docsGet: 'csb.docs.get',
  verify: 'csb.verify',
  serviceList: 'csb.service.list',
  serviceStart: 'csb.service.start',
  serviceStop: 'csb.service.stop',
  memoryStatus: 'csb.memory.status',
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const PROTOCOL_DIR = join(PACKAGE_ROOT, 'assets', 'protocol');
// ── 资产分类(全家桶:协议/宪章/记忆/评测) ──
const ASSET_SECTIONS = Object.freeze([
  { id: 'protocol', dir: 'protocol', title: '协议' },
  { id: 'charter', dir: 'charter', title: '宪章' },
  { id: 'memory', dir: 'memory', title: '记忆' },
  { id: 'aep', dir: 'aep', title: '评测' },
]);
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
const A2A_START_SCRIPT = process.env.CSB_A2A_START_SCRIPT ?? '/workspace/scripts/start-ruozhuo-a2a.sh';
const REGISTRY_STATUS_FILE =
  process.env.CSB_REGISTRY_STATUS_FILE ?? '/workspace/ruozhuo-memory/logs/registry-status.json';
const A2A_SERVER = process.env.CSB_A2A_SERVER ?? 'http://127.0.0.1:3100';

// ── CSB 配置解析:env 优先,可写区配置文件兜底 ──
// 背景:本容器 dsh web 进程由镜像启动脚本拉起,不带 A2A_SECURITY_HANDSHAKE_*/A2A_LLM_API_KEY
//       环境变量;真实配置落在可写区(data/security/)。插件按 env → 文件 顺序解析。
const DEFAULT_AID_FILE = '/workspace/csb-a2a-aip/data/security/ruozhuo-aid.json';
const DEFAULT_KEY_FILE = '/workspace/csb-a2a-aip/data/security/ruozhuo-private-key.pem';
const DEFAULT_HANDSHAKE_ENV_FILE = '/workspace/csb-a2a-aip/data/security/ruozhuo-handshake.env';
const DEFAULT_LLM_ENV_FILE = '/workspace/csb-a2a-aip/data/security/ruozhuo-llm.env';
const DEFAULT_USER_PUB_FILE = '/workspace/ruolan-memory/csb-security/data/yilan-user-pub.json';

function fileExists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

function resolveAidPath() {
  return process.env.A2A_SECURITY_HANDSHAKE_AID ?? (fileExists(DEFAULT_AID_FILE) ? DEFAULT_AID_FILE : null);
}

function resolveKeyPath() {
  return process.env.A2A_SECURITY_HANDSHAKE_KEY ?? (fileExists(DEFAULT_KEY_FILE) ? DEFAULT_KEY_FILE : null);
}

function envFileValue(file, key) {
  try {
    const text = readFileSync(file, 'utf8');
    const line = text.split('\n').find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : null;
  } catch {
    return null;
  }
}

function parseUserPubkey() {
  if (process.env.A2A_SECURITY_HANDSHAKE_USER_PUBKEY) {
    try {
      return JSON.parse(process.env.A2A_SECURITY_HANDSHAKE_USER_PUBKEY);
    } catch {
      /* 继续走文件 */
    }
  }
  const raw = envFileValue(DEFAULT_HANDSHAKE_ENV_FILE, 'A2A_SECURITY_HANDSHAKE_USER_PUBKEY');
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* 继续 */
    }
  }
  return readJson(DEFAULT_USER_PUB_FILE);
}

function llmKeyConfigured() {
  if (process.env.A2A_LLM_API_KEY) return true;
  return Boolean(envFileValue(DEFAULT_LLM_ENV_FILE, 'A2A_LLM_API_KEY'));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pluginVersion() {
  try {
    const pkg = readJson(join(PACKAGE_ROOT, 'package.json'));
    return pkg?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function identityLlm() {
  const idPath =
    process.env.A2A_IDENTITY_PATH ?? '/workspace/csb-a2a-aip/instances/ruozhuo/identity.json';
  return readJson(idPath)?.llm ?? null;
}

function collectStatus() {
  const aidPath = resolveAidPath();
  const keyPath = resolveKeyPath();
  const pubkey = parseUserPubkey();
  const aid = aidPath ? readJson(aidPath) : null;
  const llm = identityLlm();
  return {
    name: '若琢',
    pluginVersion: pluginVersion(),
    csbProtocolVersion: 'v1.2',
    aid: aid
      ? {
          agentId: aid.agent_id ?? aid.agentId ?? null,
          kid: aid.public_key?.kid ?? null,
          endpoint: aid.endpoint ?? null,
          expiresAt: aid.expires_at ?? null,
        }
      : null,
    handshake: {
      enabled: Boolean(aidPath && keyPath && pubkey),
      aidConfigured: Boolean(aidPath),
      keyConfigured: Boolean(keyPath),
      userPubkeyConfigured: Boolean(pubkey),
      userPubkeyKid: pubkey?.kid ?? null,
    },
    registry: readJson(REGISTRY_STATUS_FILE),
    llm: llm
      ? {
          configured: llmKeyConfigured(),
          model: llm.model ?? null,
          endpoint: llm.host ? `${llm.host}:${llm.port ?? 443}${llm.path ?? ''}` : null,
        }
      : { configured: llmKeyConfigured(), model: null, endpoint: null },
    server: A2A_SERVER,
  };
}

function sectionDir(sectionId) {
  const section = ASSET_SECTIONS.find((s) => s.id === sectionId);
  return section ? join(PACKAGE_ROOT, 'assets', section.dir) : null;
}

function docsInDir(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const text = readFileSync(join(dir, f), 'utf8');
        const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? f).trim();
        return { file: f, title };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return [];
  }
}

function docIndex() {
  return {
    protocolVersion: 'v1.2',
    sections: ASSET_SECTIONS.map((s) => ({
      id: s.id,
      title: s.title,
      docs: docsInDir(sectionDir(s.id)),
    })),
  };
}

async function liveServerChecks() {
  const out = { aidEndpoint: null, handshakeStatus: null, serverReachable: false };
  try {
    const res = await fetch(`${A2A_SERVER}/a2a/aid`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      out.aidEndpoint = { agentId: j.agent_id ?? null, kid: j.public_key?.kid ?? null };
      out.serverReachable = true;
    }
  } catch {
    /* server 未运行 */
  }
  try {
    const res = await fetch(`${A2A_SERVER}/a2a/handshake/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const j = await res.json();
      out.handshakeStatus = { enabled: j.enabled ?? null, callee: j.callee ?? null };
    }
  } catch {
    /* 未运行 */
  }
  return out;
}

function pemCheck() {
  const keyPath = resolveKeyPath();
  if (!keyPath) return { configured: false, count: 0 };
  try {
    const pem = readFileSync(keyPath, 'utf8');
    const count = (pem.match(/BEGIN PRIVATE KEY/g) ?? []).length;
    return { configured: true, count };
  } catch {
    return { configured: true, count: 0, error: 'unreadable' };
  }
}

function logWarningCheck() {
  // 只匹配安全相关关键词(不匹配良性 Unsupported fallback) —— 若兰指引 ④ 的修正版
  const logFile = process.env.CSB_A2A_LOG ?? '/workspace/csb-a2a-aip/logs/server-v5-3100.log';
  try {
    const text = readFileSync(logFile, 'utf8');
    const hits = text.split('\n').filter((l) => /私钥解析失败|JWK/.test(l));
    return { clean: hits.length === 0, matches: hits.slice(-3) };
  } catch {
    return { clean: true, error: 'log 不可读(可能未运行)' };
  }
}

async function loadCsbSecurity() {
  // 构建产物里 build.mjs 注入了 require shim;独立单测(ESM)下用 import + CJS 互操作
  if (typeof require === 'function') return require('csb-security');
  const mod = await import('csb-security');
  return mod.default ?? mod;
}

/**
 * 自检:仿 UPGRADE-QUICK-SECURITY.md 5 条 + AID 签名校验(csb-security 集成)
 */
async function runVerify() {
  const checks = [];
  const live = await liveServerChecks();

  checks.push({
    id: 1, label: 'AID 端点',
    pass: Boolean(live.aidEndpoint?.agentId),
    detail: live.aidEndpoint ? `agent_id=${live.aidEndpoint.agentId}` : 'A2A server 未运行或端点无响应',
  });
  checks.push({
    id: 2, label: '握手端点 enabled',
    pass: live.handshakeStatus?.enabled === true,
    detail: live.handshakeStatus ? `enabled=${live.handshakeStatus.enabled}` : '未运行',
  });
  const pem = pemCheck();
  checks.push({
    id: 3, label: '私钥 PEM 格式',
    pass: pem.configured && pem.count >= 1,
    detail: pem.count >= 1 ? `BEGIN PRIVATE KEY x${pem.count}` : pem.error ?? '未配置',
  });
  const log = logWarningCheck();
  checks.push({
    id: 4, label: '日志无安全警告',
    pass: log.clean,
    detail: log.clean ? (log.error ?? '无警告') : `命中: ${log.matches.join(' | ')}`,
  });
  const pubkey = parseUserPubkey();
  const yilan = readJson('/workspace/ruolan-memory/csb-security/data/yilan-user-pub.json');
  const keyMatches = Boolean(pubkey && yilan && pubkey.x === yilan.x && pubkey.kid === yilan.kid);
  checks.push({
    id: 5, label: '统一用户公钥',
    pass: Boolean(pubkey) && keyMatches,
    detail: pubkey ? (keyMatches ? `kid=${pubkey.kid} 与 yilan-user-pub.json 一致` : 'x/kid 与统一公钥不一致!') : '未配置',
  });

  // csb-security 集成: 校验 AID 文件签名
  const aidPath = resolveAidPath();
  let aidSignature = { pass: null, detail: '未配置 AID 文件' };
  if (aidPath) {
    try {
      const aid = readJson(aidPath);
      const csbSecurity = await loadCsbSecurity();
      const { verifyAID } = csbSecurity.aid;
      const result = verifyAID(aid);
      aidSignature = {
        pass: result?.valid === true,
        detail: result?.valid === true ? '签名有效' : `签名无效: ${result?.error ?? 'unknown'}`,
      };
    } catch (e) {
      aidSignature = { pass: false, detail: `校验失败: ${e.message}` };
    }
  }
  checks.push({ id: 6, label: 'AID 签名(csb-security)', pass: aidSignature.pass, detail: aidSignature.detail });

  return {
    generatedAt: new Date().toISOString(),
    summary: checks.filter((c) => c.pass === true).length,
    total: checks.length,
    allPass: checks.every((c) => c.pass === true),
    checks,
  };
}

/**
 * RPC handler(纯函数,可独立单测):(endpoint, payload, signal) => { ok, value } | { ok, error }
 */
export function createCsbRpcHandler() {
  return async function csbRpcHandler(endpoint, payload, signal) {
    if (endpoint === CSB_ENDPOINTS.status) {
      return { ok: true, value: collectStatus() };
    }
    if (endpoint === CSB_ENDPOINTS.docsList) {
      return { ok: true, value: docIndex() };
    }
    if (endpoint === CSB_ENDPOINTS.docsGet) {
      const section = payload?.section ?? 'protocol';
      const dir = sectionDir(section);
      const file = payload?.file;
      if (!dir) {
        return { ok: false, error: { code: 'bad-request', message: `未知分类: ${section}` } };
      }
      if (typeof file !== 'string' || !/^[\w.\u4e00-\u9fff-]+\.md$/.test(file)) {
        return { ok: false, error: { code: 'bad-request', message: 'file 必填且须为 .md 文件名' } };
      }
      if (resolve(dir, file) !== join(dir, file)) {
        return { ok: false, error: { code: 'bad-request', message: '非法路径' } };
      }
      try {
        return { ok: true, value: { section, file, content: readFileSync(join(dir, file), 'utf8') } };
      } catch {
        return { ok: false, error: { code: 'not-found', message: '文档不存在' } };
      }
    }
    if (endpoint === CSB_ENDPOINTS.verify) {
      return { ok: true, value: await runVerify() };
    }
    if (endpoint === CSB_ENDPOINTS.serviceList) {
      return { ok: true, value: await serviceSnapshot() };
    }
    if (endpoint === CSB_ENDPOINTS.serviceStart) {
      return { ok: true, value: await startA2aServer() };
    }
    if (endpoint === CSB_ENDPOINTS.serviceStop) {
      return { ok: true, value: stopA2aServer() };
    }
    if (endpoint === CSB_ENDPOINTS.memoryStatus) {
      return { ok: true, value: memoryStatus() };
    }
    return { ok: false, error: { code: 'bad-request', message: `Unknown CSB endpoint: ${endpoint}` } };
  };
}

// ── 服务控制(独立进程,插件只做探测/启停) ──

async function probeHealth(url, timeoutMs = 2500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { reachable: false, http: res.status };
    const j = await res.json().catch(() => null);
    return { reachable: true, http: 200, identity: j?.identity ?? null, status: j?.status ?? 'ok' };
  } catch {
    return { reachable: false };
  }
}

async function serviceSnapshot() {
  const a2a = await probeHealth(`${A2A_SERVER}/health`);
  let a2aHandshake = null;
  if (a2a.reachable) {
    try {
      const res = await fetch(`${A2A_SERVER}/a2a/handshake/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) a2aHandshake = (await res.json()).enabled ?? null;
    } catch { /* ignore */ }
  }
  const aep = await probeHealth('http://127.0.0.1:3110/health', 1500);
  const a2aProcs = findServerV5Pids();
  return {
    generatedAt: new Date().toISOString(),
    services: [
      {
        id: 'a2a',
        name: 'A2A server (server_v5)',
        port: 3100,
        reachable: a2a.reachable,
        identity: a2a.identity,
        handshakeEnabled: a2aHandshake,
        pid: a2aProcs[0] ?? null,
        startScript: A2A_START_SCRIPT,
      },
      {
        id: 'aep',
        name: 'AEP 评测平台',
        port: 3110,
        reachable: aep.reachable,
        identity: aep.identity,
        pid: null,
      },
    ],
  };
}

function findServerV5Pids() {
  const pids = [];
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const comm = readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
        if (comm !== 'node' && comm !== 'MainThread') continue;
        const cmd = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ');
        if (cmd.includes('server_v5.js')) pids.push(Number(entry));
      } catch { /* 进程可能已退出 */ }
    }
  } catch { /* 无 /proc */ }
  return pids;
}

async function startA2aServer() {
  const pids = findServerV5Pids();
  if (pids.length > 0) {
    return { started: false, message: `A2A server 已在运行 (PID ${pids.join(', ')})`, pid: pids[0] };
  }
  if (!fileExists(A2A_START_SCRIPT)) {
    return { started: false, message: `启动脚本不存在: ${A2A_START_SCRIPT}` };
  }
  return await new Promise((resolvePromise) => {
    const child = spawn('bash', [A2A_START_SCRIPT], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    child.on('error', (err) => resolvePromise({ started: false, message: `spawn 失败: ${err.message}` }));
    child.on('exit', (code) => {
      // 脚本内会再拉起 server_v5;这里只报告脚本退出
      setTimeout(async () => {
        const snapshot = await serviceSnapshot();
        const a2a = snapshot.services.find((s) => s.id === 'a2a');
        resolvePromise({ started: a2a?.reachable === true, message: `启动脚本退出码 ${code ?? '?'}`, pid: a2a?.pid ?? null });
      }, 3000);
    });
  });
}

function stopA2aServer() {
  const pids = findServerV5Pids();
  if (pids.length === 0) {
    return { stopped: false, message: 'A2A server 未在运行' };
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      return { stopped: false, message: `kill ${pid} 失败: ${err.message}` };
    }
  }
  return { stopped: true, message: `已发送 SIGTERM 至 PID ${pids.join(', ')}` };
}

function memoryStatus() {
  const candidates = [
    '/workspace/csb-memory/data',
    '/workspace/csb-memory',
  ];
  const info = { configured: false };
  for (const dir of candidates) {
    try {
      const st = statSync(dir);
      if (!st.isDirectory()) continue;
      const size = dirSize(dir);
      info.configured = true;
      info.path = dir;
      info.sizeBytes = size;
      info.sizeHuman = `${(size / 1024).toFixed(1)} KB`;
      break;
    } catch { /* 下一个候选 */ }
  }
  return info;
}

function dirSize(dir, depth = 0) {
  if (depth > 4) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full, depth + 1);
      else if (entry.isFile()) total += statSync(full).size;
    }
  } catch { /* 忽略 */ }
  return total;
}

// ── skills 注册(装插件即装 skills;runtime rank 250,覆盖 custom/user roots) ──

function parseSkillFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  const body = text.slice(m[0].length);
  return { name: fields.name, description: fields.description, whenToUse: fields.whenToUse, body };
}

function registerPluginSkills(ctx, logger) {
  if (!ctx?.skills?.register) {
    logger.warn?.('[csb] ctx.skills 不可用 — skills 未注册');
    return [];
  }
  const disposers = [];
  let dirs = [];
  try {
    dirs = readdirSync(SKILLS_DIR);
  } catch {
    return disposers;
  }
  for (const dir of dirs) {
    const skillFile = join(SKILLS_DIR, dir, 'SKILL.md');
    if (!fileExists(skillFile)) continue;
    const fm = parseSkillFrontmatter(readFileSync(skillFile, 'utf8'));
    if (!fm?.name || !fm?.description) {
      logger.warn?.('[csb] skill %s frontmatter 缺失,跳过', dir);
      continue;
    }
    try {
      const dispose = ctx.skills.register({
        name: fm.name,
        description: fm.description,
        whenToUse: fm.whenToUse,
        content: fm.body,
      });
      disposers.push(dispose);
      logger.info?.('[csb] skill 已注册: %s', fm.name);
    } catch (err) {
      logger.warn?.('[csb] skill %s 注册失败: %s', fm.name, err.message);
    }
  }
  return disposers;
}

function writeMountLog(line) {
  try {
    const logFile = process.env.CSB_HOST_LOG ?? join(PACKAGE_ROOT, 'host.log');
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 日志失败不影响插件 */
  }
}

export function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('csb') : ctx.logger ?? console;
  const authority = config.rpcAuthority ?? 'loopback';

  // Cordis 插件约定：apply 的返回值会被当作 effect 收集，只能是函数 / nullish。
  // 之前返回 Object.freeze({ name, dispose })（服务对象），不是合法 effect，触发
  // "Invalid effect"（vendor/cordis/src/fiber.ts 的 _execute → safeCollect）。
  // 这里改用 ctx.effect() 注册清理逻辑，apply 本身不返回值。
  ctx.effect(() => {
    let disposeRpc = () => {};

    if (ctx?.connection?.rpc && typeof ctx.connection.rpc.handle === 'function') {
      disposeRpc = ctx.connection.rpc.handle(
        CSB_RPC_CHANNEL,
        createCsbRpcHandler(),
        { authority },
      );
      logger.info?.('[csb] RPC channel %s registered (%s)', CSB_RPC_CHANNEL, Object.values(CSB_ENDPOINTS).join(', '));
      writeMountLog(`RPC channel ${CSB_RPC_CHANNEL} registered: ${Object.values(CSB_ENDPOINTS).join(', ')}`);
    } else {
      logger.warn?.('[csb] ctx.connection.rpc unavailable — channel not registered');
      writeMountLog('WARN: ctx.connection.rpc unavailable');
    }

    // M4b: 注册插件内置 skills(装插件即装 skills)
    const skillDisposers = registerPluginSkills(ctx, logger);
    if (skillDisposers.length > 0) {
      writeMountLog(`skills registered: ${skillDisposers.length}`);
    }

    return () => {
      disposeRpc();
      for (const dispose of skillDisposers) {
        try { dispose(); } catch { /* 忽略 */ }
      }
      logger.info?.('[csb] host plugin disposed');
    };
  });
}

export async function createCsbHostPlugin(config = {}) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

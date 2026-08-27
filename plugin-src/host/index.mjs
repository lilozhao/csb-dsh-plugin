// @csb/dsh-plugin · host 侧 glue plugin（M2: RPC 通道 + csb-security 集成）
//
// 端点:
//   csb.status     → { name, pluginVersion, csbProtocolVersion, aid, handshake, registry, llm }
//   csb.docs.list  → assets/protocol 文档索引
//   csb.verify     → 自检(仿 UPGRADE-QUICK-SECURITY.md 5 条 + AID 签名校验)
//
// 设计原则: 零侵入(不改 server_v5) · Secret 只读环境变量 · authority=loopback

import { readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'csb-host';
export const inject = ['connection', 'webServer'];

const CSB_RPC_CHANNEL = '/csb';
export const CSB_ENDPOINTS = Object.freeze({
  status: 'csb.status',
  docsList: 'csb.docs.list',
  verify: 'csb.verify',
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const PROTOCOL_DIR = join(PACKAGE_ROOT, 'assets', 'protocol');
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

function docIndex() {
  try {
    return readdirSync(PROTOCOL_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const text = readFileSync(join(PROTOCOL_DIR, f), 'utf8');
        const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? f).trim();
        return { file: f, title };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return [];
  }
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
      return { ok: true, value: { docs: docIndex(), protocolVersion: 'v1.2' } };
    }
    if (endpoint === CSB_ENDPOINTS.verify) {
      return { ok: true, value: await runVerify() };
    }
    return { ok: false, error: { code: 'bad-request', message: `Unknown CSB endpoint: ${endpoint}` } };
  };
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

export async function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('csb') : ctx.logger ?? console;
  const authority = config.rpcAuthority ?? 'loopback';
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

  return Object.freeze({
    name,
    async dispose() {
      disposeRpc();
      logger.info?.('[csb] host plugin disposed');
    },
  });
}

export async function createCsbHostPlugin(config = {}) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

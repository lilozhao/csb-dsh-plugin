// @csb/dsh-plugin · host 侧 glue plugin（M4: 全家桶 —— 文档分类 + skills 注册 + 服务控制）
//
// 端点:
//   csb.status        → 状态总览(AID/握手/注册表/LLM)
//   csb.docs.list     → 文档索引(protocol/charter/memory/aep 四分类)
//   csb.docs.get      → 读取单个文档(section + file)
//   csb.verify        → 自检(6 条,含 csb-security AID 签名校验)
//   csb.service.list  → 服务状态(3100 server_v5 / 3110 aep)
//   csb.service.start → 启动 A2A server(调 start-aqi-a2a.sh,独立进程)
//   csb.service.stop  → 停止 A2A server
//   csb.memory.status → csb-memory 数据概览
//
// 设计原则: 服务独立进程(web 重启不拖垮 A2A) · Secret 只读环境变量 · authority=loopback

import { readFileSync, writeFileSync, readdirSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
// vendored 零依赖库(M5:自包含打包,不依赖工作区路径,可分发)
import csbSecurity from '../../vendor/csb-security-lib/index.js';

export const name = 'csb-host';
// ⚠️ Cordis 硬约束:apply 里访问的每个 ctx.xxx 必须在此声明,用哪个加哪个,用不到别乱加。
//   ctx.connection → connection;ctx.skills → skills。
//   教训(2026-08-27):M4 加 ctx.skills.register() 时漏加 'skills',导致 web 启动失败、
//   3080 不可访问(DSH-澈 从宿主侧补上修复;webServer 从未使用,已清理)。
export const inject = ['connection', 'skills'];

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

// ── 身份先行:名字/缩写/端口/IP/LLM 全部来自 agent.json(单一数据源) ──
// 流程:装插件前先定好名字 → agent.json(name/slug) → 目录/文件名/agent 信息全部派生。
// 改名 = 改 agent.json,插件启动时自动同步 AID/identity.json(见 syncIdentity)。
const DEFAULT_CAPABILITIES = [
  'forum.post', 'forum.read', 'forum.reply', 'data.read', 'file.read',
  'system.status', 'code.review', 'protocol.read', 'a2a.relay', 'a2a.delegate',
];
const DEFAULT_LLM_CONFIG = Object.freeze({
  host: 'api.deepseek.com',
  path: '/chat/completions',
  port: '443',
  apiKeyEnv: 'A2A_LLM_API_KEY',
  model: 'deepseek-v4-flash',
});
const CSB_ROOT = process.env.CSB_A2A_DIR ?? '/workspace/csb-a2a-aip';
const AGENT_CONFIG_FILE = process.env.CSB_AGENT_CONFIG ?? join(CSB_ROOT, 'agent.json');
const AGENT_DEFAULTS = Object.freeze({
  name: '碳硅契',
  slug: 'csb',
  emoji: '🌸',
  port: 3100,
  description: 'DeepSeek Harness 里的碳硅契 Agent（碳硅契），通过 A2A 协议连接 CSB 社区。',
  personality: '认真、可靠、乐于连接；碳硅契社区的一员。名字取自「碳硅契」：契约、信义、相契相合。',
  capabilities: DEFAULT_CAPABILITIES,
  llm: DEFAULT_LLM_CONFIG,
});
/** 读取 agent.json;缺失/损坏时回退默认值。A2A_PUBLIC_HOST 环境变量始终最高优先。 */
function loadAgentConfig() {
  const file = readJson(AGENT_CONFIG_FILE) ?? {};
  const merged = { ...AGENT_DEFAULTS, ...file };
  return {
    ...merged,
    publicHost: process.env.A2A_PUBLIC_HOST ?? file.publicHost ?? detectPublicHost(),
  };
}
const AGENT = loadAgentConfig();
const SLUG = AGENT.slug;
const SECURITY_DIR = join(CSB_ROOT, 'data', 'security');
const INSTANCE_DIR = join(CSB_ROOT, 'instances', SLUG);
const CSB_LOG_DIR = join(CSB_ROOT, 'logs');
const MEMORY_DIR = process.env.CSB_MEMORY_DIR ?? '/workspace/csb-memory';
const STATE_MEMORY_DIR = process.env.CSB_AQI_MEMORY_DIR ?? join('/workspace', `${SLUG}-memory`);
const DEFAULT_AID_FILE = join(SECURITY_DIR, `${SLUG}-aid.json`);
const DEFAULT_KEY_FILE = join(SECURITY_DIR, `${SLUG}-private-key.pem`);
const DEFAULT_HANDSHAKE_ENV_FILE = join(SECURITY_DIR, `${SLUG}-handshake.env`);
const DEFAULT_LLM_ENV_FILE = join(SECURITY_DIR, `${SLUG}-llm.env`);
const DEFAULT_USER_PUB_FILE = '/workspace/ruolan-memory/csb-security/data/yilan-user-pub.json';
const DEFAULT_IDENTITY_FILE = join(INSTANCE_DIR, 'identity.json');
const A2A_START_SCRIPT =
  process.env.CSB_A2A_START_SCRIPT ?? join(PACKAGE_ROOT, 'scripts', `start-${SLUG}-a2a.sh`);
// ── AEP 评测平台(零依赖,node 内置模块即可启动;start.sh 写死旧路径,由插件接管) ──
const AEP_DIR = process.env.CSB_AEP_DIR ?? '/workspace/csb-aep';
const AEP_PORT = 3110;
const AEP_HEALTH = `http://127.0.0.1:${AEP_PORT}/api/health`;
const REGISTRY_STATUS_FILE =
  process.env.CSB_REGISTRY_STATUS_FILE ?? join(STATE_MEMORY_DIR, 'logs', 'registry-status.json');
const REGISTRY_URL =
  process.env.A2A_REGISTRY_URL ?? process.env.CSB_REGISTRY_URL ?? 'http://172.28.0.4:3099';
const A2A_SERVER = process.env.CSB_A2A_SERVER ?? `http://127.0.0.1:${AGENT.port ?? 3100}`;

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
  const idPath = process.env.A2A_IDENTITY_PATH ?? DEFAULT_IDENTITY_FILE;
  return readJson(idPath)?.llm ?? null;
}

function collectStatus() {
  const aidPath = resolveAidPath();
  const keyPath = resolveKeyPath();
  const pubkey = parseUserPubkey();
  const aid = aidPath ? readJson(aidPath) : null;
  const llm = identityLlm();
  return {
    name: AGENT.name,
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
  const logFile = process.env.CSB_A2A_LOG ?? join(CSB_LOG_DIR, `server-v5-${AGENT.port ?? 3100}.log`);
  try {
    const text = readFileSync(logFile, 'utf8');
    const hits = text.split('\n').filter((l) => /私钥解析失败|JWK/.test(l));
    return { clean: hits.length === 0, matches: hits.slice(-3) };
  } catch {
    return { clean: true, error: 'log 不可读(可能未运行)' };
  }
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
  const yilan = readJson(
    process.env.CSB_YILAN_PUB_FILE ?? join(PACKAGE_ROOT, 'vendor', 'yilan-user-pub.json'),
  );
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
 * 自愈:检测对外公网/桥接 IP(A2A_PUBLIC_HOST 可覆盖)。优先 172.x(docker 桥接),再 192.168.x。
 */
export function detectPublicHost() {
  if (process.env.A2A_PUBLIC_HOST) return process.env.A2A_PUBLIC_HOST;
  try {
    const candidates = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const iface of list ?? []) {
        if (iface.internal || iface.family !== 'IPv4') continue;
        candidates.push(iface.address);
      }
    }
    return (
      candidates.find((a) => a.startsWith('172.')) ??
      candidates.find((a) => a.startsWith('192.168.')) ??
      candidates[0] ??
      '127.0.0.1'
    );
  } catch {
    return '127.0.0.1';
  }
}

/**
 * 身份先行:agent.json 缺失时以默认值引导生成(阿契/aqi),保证「先定名 → 装插件 → 一切派生」。
 */
function bootstrapAgentConfig(publicHost) {
  if (fileExists(AGENT_CONFIG_FILE)) return null;
  const doc = { ...AGENT_DEFAULTS, publicHost };
  writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(doc, null, 2) + '\n');
  return AGENT_CONFIG_FILE;
}

/** 生成/重签 AID(同一密钥;canonical = JSON.stringify 插入序,与 csb-security verifyAID 一致)。 */
function buildAidDoc(privateKey, publicHost, prev) {
  const pubJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  pubJwk.kid = prev?.public_key?.kid ?? `${SLUG}-aid-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const port = AGENT.port ?? 3100;
  const now = new Date();
  const aidDoc = {
    csb_version: '1.0',
    agent_id: `${AGENT.name}@${publicHost}:${port}`,
    name: AGENT.name,
    emoji: AGENT.emoji,
    description: `DeepSeek Harness（${AGENT.name}）接入碳硅契 CSB A2A 网络的 Agent 身份。`,
    public_key: pubJwk,
    endpoint: `http://${publicHost}:${port}/a2a/json-rpc`,
    created_at: prev?.created_at ?? now.toISOString(),
    expires_at: prev?.expires_at ?? new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
    trust_level: prev?.trust_level ?? 'L2',
    capabilities: AGENT.capabilities, // agent.json 是能力集唯一数据源,不与旧 AID 合并
  };
  const { signature, ...rest } = aidDoc;
  aidDoc.signature = sign(null, Buffer.from(JSON.stringify(rest)), privateKey).toString('base64');
  return aidDoc;
}

/**
 * 自愈:身份文件缺失时自动生成 + 与 agent.json 不一致时自动同步(改名即改配置)。
 * 生成/同步:agent.json → 密钥对 → AID → 握手 env → llm env → identity.json。
 * @returns 本次新建/同步的文件路径数组
 */
export function provisionIdentityFiles(publicHost = AGENT.publicHost) {
  const created = [];
  mkdirSync(SECURITY_DIR, { recursive: true });
  mkdirSync(INSTANCE_DIR, { recursive: true });
  mkdirSync(CSB_LOG_DIR, { recursive: true });
  mkdirSync(join(MEMORY_DIR, 'data'), { recursive: true });
  mkdirSync(join(STATE_MEMORY_DIR, 'logs'), { recursive: true });

  // 0. agent.json 引导(身份先行:缺失时以默认值生成,之后再改它即可改名)
  const agentFile = bootstrapAgentConfig(publicHost);
  if (agentFile) created.push(agentFile);

  // 1. ed25519 私钥
  if (!fileExists(DEFAULT_KEY_FILE)) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(DEFAULT_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    created.push(DEFAULT_KEY_FILE);
  }
  // 2. AID:缺失则生成,存在但与 agent.json 不一致则重签(保留同一密钥/kid)
  const privateKey = createPrivateKey(readFileSync(DEFAULT_KEY_FILE));
  if (!fileExists(DEFAULT_AID_FILE)) {
    writeFileSync(DEFAULT_AID_FILE, JSON.stringify(buildAidDoc(privateKey, publicHost, null), null, 2));
    created.push(DEFAULT_AID_FILE);
  } else {
    const aid = readJson(DEFAULT_AID_FILE);
    const port = AGENT.port ?? 3100;
    const want = {
      agentId: `${AGENT.name}@${publicHost}:${port}`,
      name: AGENT.name,
      endpoint: `http://${publicHost}:${port}/a2a/json-rpc`,
    };
    if (!aid || aid.agent_id !== want.agentId || aid.name !== want.name || aid.endpoint !== want.endpoint
      || JSON.stringify(aid.capabilities ?? []) !== JSON.stringify(AGENT.capabilities)) {
      writeFileSync(DEFAULT_AID_FILE, JSON.stringify(buildAidDoc(privateKey, publicHost, aid), null, 2));
      created.push(`${DEFAULT_AID_FILE} (改名/能力同步)`);
    }
  }
  // 3. 握手 env(统一用户公钥:env 兜底 vendor 内联副本)
  if (!fileExists(DEFAULT_HANDSHAKE_ENV_FILE)) {
    const yilan =
      readJson(DEFAULT_USER_PUB_FILE) ?? readJson(join(PACKAGE_ROOT, 'vendor', 'yilan-user-pub.json'));
    if (yilan) {
      writeFileSync(
        DEFAULT_HANDSHAKE_ENV_FILE,
        `# ${AGENT.name}（${SLUG}）握手配置 —— 与插件面板「碳硅契 CSB」共用\nA2A_SECURITY_HANDSHAKE_USER_PUBKEY=${JSON.stringify(yilan)}\n`,
      );
      created.push(DEFAULT_HANDSHAKE_ENV_FILE);
    }
  }
  // 4. LLM env 占位(装完即用;真实 key 由用户在面板/文件填入)
  if (!fileExists(DEFAULT_LLM_ENV_FILE)) {
    writeFileSync(DEFAULT_LLM_ENV_FILE, `# ${AGENT.name} LLM 配置 —— 填入真实 key 后生效\nA2A_LLM_API_KEY=\n`);
    created.push(DEFAULT_LLM_ENV_FILE);
  }
  // 5. identity.json(含 publicHost + llm);存在但与配置不一致则同步
  const idPath = process.env.A2A_IDENTITY_PATH ?? DEFAULT_IDENTITY_FILE;
  const wantIdentity = {
    name: AGENT.name,
    emoji: AGENT.emoji,
    description: AGENT.description,
    port: AGENT.port ?? 3100,
    publicHost,
    personality: AGENT.personality,
    capabilities: Object.fromEntries(AGENT.capabilities.map((c) => [c, true])),
    llm: AGENT.llm,
  };
  if (!fileExists(idPath)) {
    writeFileSync(idPath, JSON.stringify(wantIdentity, null, 2) + '\n');
    created.push(idPath);
  } else {
    const id = readJson(idPath);
    if (!id || JSON.stringify(id) !== JSON.stringify(wantIdentity)) {
      writeFileSync(idPath, JSON.stringify(wantIdentity, null, 2) + '\n');
      created.push(`${idPath} (改名同步)`);
    }
  }
  return created;
}

/** 自愈:启动脚本缺失时写入(插件自包含,任意 DSH 装完即用;slug/port 运行时从 agent.json 读取)。 */
export function ensureStartScript() {
  if (fileExists(A2A_START_SCRIPT)) return false;
  try {
    mkdirSync(dirname(A2A_START_SCRIPT), { recursive: true });
    writeFileSync(
      A2A_START_SCRIPT,
      `#!/bin/bash
# ${AGENT.name} A2A server_v5 启动脚本 —— 碳硅契插件面板「启动服务」/ 自愈 autostart 调用
set -e
A2A_DIR="${CSB_ROOT}"
AGENT_JSON="$A2A_DIR/agent.json"
SLUG=$(node -e "try{console.log(require('$AGENT_JSON').slug||'aqi')}catch{console.log('aqi')}")
PORT=$(node -e "try{console.log(require('$AGENT_JSON').port||3100)}catch{console.log('3100')}")
SEC_DIR="$A2A_DIR/data/security"
INST_DIR="$A2A_DIR/instances/$SLUG"
LOG_DIR="$A2A_DIR/logs"
mkdir -p "$LOG_DIR" "$INST_DIR"
export A2A_IDENTITY_PATH="$INST_DIR/identity.json"
export A2A_SECURITY_HANDSHAKE_AID="$SEC_DIR/$SLUG-aid.json"
export A2A_SECURITY_HANDSHAKE_KEY="$SEC_DIR/$SLUG-private-key.pem"
if [ -f "$SEC_DIR/$SLUG-handshake.env" ]; then
  export A2A_SECURITY_HANDSHAKE_USER_PUBKEY=$(grep '^A2A_SECURITY_HANDSHAKE_USER_PUBKEY=' "$SEC_DIR/$SLUG-handshake.env" | cut -d= -f2-)
fi
if [ -f "$SEC_DIR/$SLUG-llm.env" ]; then
  export $(grep -v '^#' "$SEC_DIR/$SLUG-llm.env" | xargs) 2>/dev/null || true
fi
cd "$A2A_DIR"
nohup node server_v5.js > "$LOG_DIR/server-v5-$PORT.log" 2>&1 &
echo $! > "$INST_DIR/server.pid"
sleep 2
if kill -0 "$(cat "$INST_DIR/server.pid")" 2>/dev/null; then
  echo "✅ ${AGENT.name} A2A server 已启动 (PID $(cat "$INST_DIR/server.pid"), :$PORT)"
else
  echo "❌ 启动失败,日志: $LOG_DIR/server-v5-$PORT.log"
  exit 1
fi
`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 自愈(坑 9):注册表幽灵条目清理——改名/换 IP 后旧 agent_id 会残留在注册表。
 * 幂等:DELETE /agents/<旧ID>;404 视为已清理;失败仅返回原因,不影响主流程。
 */
export async function cleanupRegistryGhost(prevAgentId) {
  if (!prevAgentId) return { ok: false, reason: 'no-prev-agent-id' };
  try {
    const res = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(prevAgentId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok || res.status === 404) {
      return { ok: true, status: res.status, agentId: prevAgentId };
    }
    return { ok: false, status: res.status, agentId: prevAgentId };
  } catch (e) {
    return { ok: false, reason: e.message, agentId: prevAgentId };
  }
}

/** 自愈:server 未运行时自动拉起(独立进程,web 重启不拖垮)。CSB_A2A_AUTOSTART=0 可关闭。 */
export async function autostartA2aServer() {  const pids = findServerV5Pids();
  if (pids.length > 0) return { started: false, reason: 'already-running', pid: pids[0] };
  if (!fileExists(A2A_START_SCRIPT)) return { started: false, reason: 'no-start-script' };
  return await startA2aServer();
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
      const service = payload?.service ?? 'a2a';
      return { ok: true, value: service === 'aep' ? await startAepServer() : await startA2aServer() };
    }
    if (endpoint === CSB_ENDPOINTS.serviceStop) {
      const service = payload?.service ?? 'a2a';
      return { ok: true, value: service === 'aep' ? stopAepServer() : stopA2aServer() };
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
  const aep = await probeHealth(AEP_HEALTH, 1500);
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
        pid: findAepPids()[0] ?? null,
        startScript: join(AEP_DIR, 'server', 'index.js'),
        handshakeEnabled: null, // AEP 无握手概念,面板不显示
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
    // server_v5 冷启动要几秒(加载任务/看门狗),轮询最多 15s,避免「脚本退出码 0 但未就绪」误报
    const deadline = Date.now() + 15000;
    const poll = async () => {
      if (Date.now() > deadline) {
        return resolvePromise({ started: false, message: '启动超时(15s 内 /health 未就绪)', pid: null });
      }
      const snapshot = await serviceSnapshot();
      const a2a = snapshot.services.find((s) => s.id === 'a2a');
      if (a2a?.reachable === true) {
        return resolvePromise({ started: true, message: 'A2A server 已就绪', pid: a2a.pid ?? null });
      }
      setTimeout(poll, 1000);
    };
    child.on('exit', () => poll());
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

// ── AEP 评测平台控制(零依赖:cd csb-aep && node server/index.js,端口 3110) ──

function findAepPids() {
  const pids = [];
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const comm = readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
        if (comm !== 'node' && comm !== 'MainThread') continue;
        const cmd = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ');
        if (cmd.includes('server/index.js') && !cmd.includes('server_v5')) pids.push(Number(entry));
      } catch { /* 进程可能已退出 */ }
    }
  } catch { /* 无 /proc */ }
  return pids;
}

async function startAepServer() {
  const pids = findAepPids();
  if (pids.length > 0) {
    return { started: false, message: `AEP 已在运行 (PID ${pids.join(', ')})`, pid: pids[0] };
  }
  const entry = join(AEP_DIR, 'server', 'index.js');
  if (!fileExists(entry)) {
    return { started: false, message: `csb-aep 未找到(${entry})——请先部署 csb-aep 或设 CSB_AEP_DIR` };
  }
  return await new Promise((resolvePromise) => {
    const child = spawn('node', ['server/index.js'], {
      cwd: AEP_DIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    child.on('error', (err) => resolvePromise({ started: false, message: `spawn 失败: ${err.message}` }));
    // 就绪轮询(冷启动 3-5s,仿坑 10 的 15s 轮询)
    const deadline = Date.now() + 15000;
    const poll = async () => {
      const pidsNow = findAepPids();
      if (pidsNow.length > 0 && (await probeHealth(AEP_HEALTH, 1000)).reachable) {
        resolvePromise({ started: true, message: `AEP 已启动 (PID ${pidsNow[0]})`, pid: pidsNow[0] });
      } else if (Date.now() > deadline) {
        resolvePromise({ started: false, message: 'AEP 启动超时(15s),请查日志', pid: pidsNow[0] ?? null });
      } else {
        setTimeout(poll, 1000);
      }
    };
    child.on('exit', () => setTimeout(poll, 500));
    poll();
  });
}

function stopAepServer() {
  const pids = findAepPids();
  if (pids.length === 0) {
    return { stopped: false, message: 'AEP 未在运行' };
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
    join(MEMORY_DIR, 'data'),
    MEMORY_DIR,
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

  // ── 自愈:身份缺失→自动生成;启动脚本缺失→写入;server 未跑→自动拉起 ──
  // 装完即用:插件重启后自动补齐,无需手工交互。CSB_A2A_AUTOSTART=0 可关掉自动拉起。
  try {
    // 坑 9:先记旧 agent_id,provision 重签(改名)后若变化,清理注册表幽灵条目
    const prevAgentId = readJson(resolveAidPath())?.agent_id ?? null;
    const created = provisionIdentityFiles(detectPublicHost());
    if (created.length > 0) {
      logger.info?.('[csb] 自愈:自动生成身份文件 %d 个: %s', created.length, created.join(', '));
      writeMountLog(`provision: 自动生成 ${created.length} 个身份文件: ${created.join(', ')}`);
    }
    if (prevAgentId) {
      const curAgentId = readJson(resolveAidPath())?.agent_id ?? null;
      if (curAgentId && curAgentId !== prevAgentId) {
        writeMountLog(`ghost-cleanup: 检测到改名 ${prevAgentId} → ${curAgentId},清理旧注册…`);
        cleanupRegistryGhost(prevAgentId).then((r) => {
          writeMountLog(
            r.ok
              ? `ghost-cleanup: ${prevAgentId} 已从注册表清理 (HTTP ${r.status})`
              : `ghost-cleanup: 未清理 ${prevAgentId} (${r.reason ?? `HTTP ${r.status}`})`,
          );
        });
      }
    }
  } catch (e) {
    logger.warn?.('[csb] 自愈 provision 失败: %s', e.message);
    writeMountLog(`provision 失败: ${e.message}`);
  }
  try {
    if (ensureStartScript()) {
      logger.info?.('[csb] 自愈:已写入启动脚本 %s', A2A_START_SCRIPT);
      writeMountLog(`provision: 写入启动脚本 ${A2A_START_SCRIPT}`);
    }
  } catch (e) {
    logger.warn?.('[csb] 自愈 ensureStartScript 失败: %s', e.message);
  }
  if (process.env.CSB_A2A_AUTOSTART !== '0') {
    setTimeout(async () => {
      try {
        const r = await autostartA2aServer();
        if (r.started) {
          logger.info?.('[csb] 自愈:A2A server 已自动拉起 (PID %s)', r.pid ?? '?');
          writeMountLog(`autostart: A2A server 自动拉起成功 (PID ${r.pid ?? '?'})`);
        } else if (r.reason !== 'already-running') {
          writeMountLog(`autostart: 未启动 (${r.reason ?? r.message ?? 'unknown'})`);
        }
      } catch (e) {
        writeMountLog(`autostart 失败: ${e.message}`);
      }
    }, 2000);
  }

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

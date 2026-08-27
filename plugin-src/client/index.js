// @csb/dsh-plugin · client 侧「碳硅契 CSB」设置页（M3）
//
// 面板三块:状态卡(csb.status) · 协议文档树(csb.docs.list / csb.docs.get) · 自检(csb.verify)
// 调用模式参照 @xmanrui/dsh-im:apply 里注册 'settings.plugins.tab' 插槽,
// inject 注入 rpcCall,组件用 h() 无 JSX 风格(与 esbuild 构建匹配)。

import * as React from 'react';

export const name = 'csb-settings';
export const inject = ['slots', 'connection'];

const CSB_RPC_CHANNEL = '/csb';
const ENDPOINTS = Object.freeze({
  status: 'csb.status',
  docsList: 'csb.docs.list',
  docsGet: 'csb.docs.get',
  verify: 'csb.verify',
});

const h = React.createElement;

// ── 小工具 ──
function unwrap(result) {
  if (!result || typeof result.ok !== 'boolean') {
    throw new Error('碳硅契服务返回了无法识别的响应');
  }
  if (!result.ok) {
    const err = new Error(result.error?.message ?? '碳硅契服务请求失败');
    err.code = result.error?.code ?? 'CSB_RPC_ERROR';
    throw err;
  }
  return result.value;
}

const styles = {
  section: { marginBottom: 18 },
  card: { border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 10 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 13 },
  label: { color: 'rgba(128,128,128,.85)' },
  ok: { color: '#3fb950', fontWeight: 600 },
  bad: { color: '#f85149', fontWeight: 600 },
  neutral: { color: '#d29922', fontWeight: 600 },
  title: { fontSize: 14, fontWeight: 600, margin: '0 0 8px' },
  docItem: { padding: '6px 10px', cursor: 'pointer', borderRadius: 6, fontSize: 13 },
  docItemHover: { background: 'rgba(128,128,128,.12)' },
  pre: { maxHeight: 320, overflow: 'auto', background: 'rgba(0,0,0,.35)', border: '1px solid rgba(128,128,128,.2)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  btn: { padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'rgba(128,128,128,.12)', cursor: 'pointer', fontSize: 13, color: 'inherit' },
  error: { color: '#f85149', fontSize: 13 },
  muted: { color: 'rgba(128,128,128,.7)', fontSize: 12 },
};

function Badge({ ok, text }) {
  return h('span', { style: ok ? styles.ok : ok === false ? styles.bad : styles.neutral }, text);
}

function Row({ label, value, badge }) {
  return h('div', { style: styles.row },
    h('span', { style: styles.label }, label),
    badge ? h(Badge, { ok: badge.ok, text: badge.text }) : h('span', null, value ?? '—'),
  );
}

function StatusCard({ status }) {
  if (!status) return h('div', { style: styles.card }, '加载中…');
  const hs = status.handshake ?? {};
  const llm = status.llm ?? {};
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, '状态'),
    h(Row, { label: '身份', value: status.aid?.agentId ?? status.name, badge: status.aid ? { ok: true, text: 'AID' } : { ok: false, text: '无 AID' } }),
    h(Row, { label: '握手端点', badge: { ok: hs.enabled, text: hs.enabled ? '已启用' : '未启用' } }),
    h(Row, { label: '用户公钥', value: hs.userPubkeyKid ?? null, badge: { ok: hs.userPubkeyConfigured, text: hs.userPubkeyConfigured ? '已配置' : '未配置' } }),
    h(Row, { label: '注册表', value: status.registry ? `${status.registry.ip}:${status.registry.port}` : null, badge: { ok: status.registry?.status === 'up', text: status.registry?.status ?? '未知' } }),
    h(Row, { label: 'LLM', value: llm.model ?? null, badge: { ok: llm.configured, text: llm.configured ? '已配置' : '未配置' } }),
    h(Row, { label: '协议版本', value: status.csbProtocolVersion ?? null }),
    h('div', { style: styles.muted }, `插件 v${status.pluginVersion ?? '?'} · 服务器 ${status.server ?? ''}`),
  );
}

function DocsPanel({ docs, openFile, content, loading, onOpen }) {
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, '协议文档'),
    !docs ? h('div', null, '加载中…')
      : docs.length === 0 ? h('div', { style: styles.muted }, '暂无文档')
      : docs.map((d) =>
          h('div', {
            key: d.file,
            style: openFile === d.file ? { ...styles.docItem, ...styles.docItemHover } : styles.docItem,
            onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(128,128,128,.12)'; },
            onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
            onClick: () => onOpen(d.file),
          },
            h('span', null, '📄 '),
            h('span', null, d.title),
            h('span', { style: styles.muted }, `  (${d.file})`),
          ),
        ),
    openFile ? h('div', { style: { marginTop: 10 } },
      h('div', { style: { ...styles.title, fontSize: 13 } }, openFile),
      content === null
        ? h('div', { style: styles.muted }, loading ? '加载中…' : '')
        : h('pre', { style: styles.pre }, content),
    ) : null,
  );
}

function VerifyPanel({ verify, busy, onRun }) {
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, '安全自检'),
    h('button', { style: styles.btn, onClick: onRun, disabled: busy }, busy ? '自检中…' : '运行自检'),
    verify?.error ? h('div', { style: styles.error }, `自检失败: ${verify.error}`) : null,
    verify?.checks ? h('div', { style: { marginTop: 10 } },
      h('div', null,
        '结果: ',
        h(Badge, { ok: verify.allPass, text: verify.allPass ? `全部通过 (${verify.summary}/${verify.total})` : `${verify.summary}/${verify.total} 通过` }),
      ),
      verify.checks.map((c) =>
        h('div', { key: c.id, style: { ...styles.row, padding: '3px 0' } },
          h('span', { style: styles.label }, `${c.id}. ${c.label}`),
          h('span', { style: { fontSize: 12, color: 'rgba(128,128,128,.8)', textAlign: 'right', maxWidth: '60%' } }, c.detail),
        ),
      ),
    ) : null,
  );
}

function CsbPanel({ rpcCall }) {
  const [status, setStatus] = React.useState(null);
  const [docs, setDocs] = React.useState(null);
  const [openFile, setOpenFile] = React.useState(null);
  const [content, setContent] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [verify, setVerify] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, d] = await Promise.all([
          rpcCall(ENDPOINTS.status, {}).then(unwrap),
          rpcCall(ENDPOINTS.docsList, {}).then(unwrap),
        ]);
        if (!cancelled) {
          setStatus(s);
          setDocs(d.docs);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = async (file) => {
    setOpenFile(file);
    setContent(null);
    setLoading(true);
    try {
      const v = await rpcCall(ENDPOINTS.docsGet, { file }).then(unwrap);
      setContent(v.content);
    } catch (e) {
      setContent(`加载失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const runVerify = async () => {
    setBusy(true);
    setVerify(null);
    try {
      const v = await rpcCall(ENDPOINTS.verify, {}).then(unwrap);
      setVerify(v);
    } catch (e) {
      setVerify({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return h('div', { style: { padding: '4px 0' } },
    error ? h('div', { style: styles.error }, `碳硅契服务不可用: ${error}`) : null,
    h('div', { style: styles.section }, h(StatusCard, { status })),
    h('div', { style: styles.section }, h(DocsPanel, { docs, openFile, content, loading, onOpen: openDoc })),
    h('div', { style: styles.section }, h(VerifyPanel, { verify, busy, onRun: runVerify })),
  );
}

export async function apply(ctx, config = {}) {
  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(CSB_RPC_CHANNEL, endpoint, payload, signal);

  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: 'csb',
        order: 30,
        label: () => '碳硅契 CSB',
        inject: () => ({ rpcCall }),
      },
      CsbPanel,
    ),
  );
}

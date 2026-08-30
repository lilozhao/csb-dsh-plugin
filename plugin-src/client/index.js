// @csb/dsh-plugin · client 侧「碳硅契 CSB」设置页（M4: 全家桶）
//
// 面板:状态卡(csb.status) · 服务(csb.service.list/start/stop) · 文档树四分类
//      (csb.docs.list / csb.docs.get) · 自检(csb.verify) · 记忆概览(csb.memory.status)
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
  serviceList: 'csb.service.list',
  serviceStart: 'csb.service.start',
  serviceStop: 'csb.service.stop',
  memoryStatus: 'csb.memory.status',
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
  tabBar: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  tab: { padding: '4px 12px', borderRadius: 12, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'inherit' },
  tabActive: { padding: '4px 12px', borderRadius: 12, border: '1px solid rgba(128,128,128,.6)', background: 'rgba(128,128,128,.18)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'inherit' },
  pre: { maxHeight: 320, overflow: 'auto', background: 'rgba(0,0,0,.35)', border: '1px solid rgba(128,128,128,.2)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  btn: { padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'rgba(128,128,128,.12)', cursor: 'pointer', fontSize: 13, color: 'inherit' },
  btnDanger: { padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(248,81,73,.5)', background: 'rgba(248,81,73,.12)', cursor: 'pointer', fontSize: 13, color: '#f85149' },
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

function StatusCard({ status, memory }) {
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
    h(Row, { label: 'CSB 记忆', value: memory?.sizeHuman ?? null, badge: { ok: memory?.configured, text: memory?.configured ? '可用' : '未发现' } }),
    h(Row, { label: '协议版本', value: status.csbProtocolVersion ?? null }),
    h('div', { style: styles.muted }, `插件 v${status.pluginVersion ?? '?'} · 服务器 ${status.server ?? ''}`),
  );
}

function ServicesPanel({ services, busy, onStart, onStop }) {
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, '服务(独立进程)'),
    !services ? h('div', null, '加载中…')
      : services.map((s) =>
          h('div', { key: s.id, style: { ...styles.row, gap: 8 } },
            h('span', { style: styles.label, flex: 1 }, `${s.name} (:${s.port})`),
            h('span', null,
              h(Badge, { ok: s.reachable, text: s.reachable ? (s.identity ?? '在线') : '离线' }),
               s.handshakeEnabled != null ? h('span', { style: styles.muted }, ` 握手:${s.handshakeEnabled ? '✅' : '❌'}`) : null,
              s.pid ? h('span', { style: styles.muted }, ` PID:${s.pid}`) : null,
            ),
            h('span', { style: { display: 'flex', gap: 6 } },
              h('button', { style: styles.btn, onClick: () => onStart(s.id), disabled: busy }, '启动'),
              h('button', { style: styles.btnDanger, onClick: () => onStop(s.id), disabled: busy }, '停止'),
            ),
          ),
        ),
  );
}

function DocsPanel({ sections, activeSection, openFile, content, loading, onSelectSection, onOpen }) {
  const active = sections?.find((s) => s.id === activeSection);
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, '文档(协议/宪章/记忆/评测)'),
    sections ? h('div', { style: styles.tabBar },
      sections.map((s) =>
        h('button', {
          key: s.id,
          style: s.id === activeSection ? styles.tabActive : styles.tab,
          onClick: () => onSelectSection(s.id),
        }, `${s.title} (${s.docs.length})`),
      ),
    ) : null,
    !active ? h('div', null, '加载中…')
      : active.docs.length === 0 ? h('div', { style: styles.muted }, '该分类暂无文档')
      : active.docs.map((d) =>
          h('div', {
            key: d.file,
            style: openFile === d.file ? { ...styles.docItem, ...styles.docItemHover } : styles.docItem,
            onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(128,128,128,.12)'; },
            onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
            onClick: () => onOpen(activeSection, d.file),
          },
            h('span', null, '📄 '),
            h('span', null, d.title),
            h('span', { style: styles.muted }, `  (${d.file})`),
          ),
        ),
    openFile ? h('div', { style: { marginTop: 10 } },
      h('div', { style: { ...styles.title, fontSize: 13 } }, `${activeSection}/${openFile}`),
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
  const [memory, setMemory] = React.useState(null);
  const [services, setServices] = React.useState(null);
  const [sections, setSections] = React.useState(null);
  const [activeSection, setActiveSection] = React.useState('protocol');
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
        const [s, d, sv, mem] = await Promise.all([
          rpcCall(ENDPOINTS.status, {}).then(unwrap),
          rpcCall(ENDPOINTS.docsList, {}).then(unwrap),
          rpcCall(ENDPOINTS.serviceList, {}).then(unwrap),
          rpcCall(ENDPOINTS.memoryStatus, {}).then(unwrap).catch(() => null),
        ]);
        if (!cancelled) {
          setStatus(s);
          setSections(d.sections);
          setServices(sv.services);
          setMemory(mem);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = async (section, file) => {
    setActiveSection(section);
    setOpenFile(file);
    setContent(null);
    setLoading(true);
    try {
      const v = await rpcCall(ENDPOINTS.docsGet, { section, file }).then(unwrap);
      setContent(v.content);
    } catch (e) {
      setContent(`加载失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshServices = async () => {
    try {
      const sv = await rpcCall(ENDPOINTS.serviceList, {}).then(unwrap);
      setServices(sv.services);
    } catch (e) {
      setError(e.message);
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

  const startService = async (serviceId) => {
    setBusy(true);
    try {
      const r = await rpcCall(ENDPOINTS.serviceStart, { service: serviceId }).then(unwrap);
      setError(r.started ? null : `启动提示: ${r.message}`);
      await refreshServices();
    } catch (e) {
      setError(`启动失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const stopService = async (serviceId) => {
    setBusy(true);
    try {
      const r = await rpcCall(ENDPOINTS.serviceStop, { service: serviceId }).then(unwrap);
      setError(r.stopped ? null : `停止提示: ${r.message}`);
      await refreshServices();
    } catch (e) {
      setError(`停止失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return h('div', { style: { padding: '4px 0' } },
    error ? h('div', { style: styles.error }, `碳硅契提示: ${error}`) : null,
    h('div', { style: styles.section }, h(StatusCard, { status, memory })),
    h('div', { style: styles.section }, h(ServicesPanel, { services, busy, onStart: startService, onStop: stopService })),
    h('div', { style: styles.section }, h(DocsPanel, { sections, activeSection, openFile, content, loading, onSelectSection: setActiveSection, onOpen: openDoc })),
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

window.__ModuleLoader__.load({
  id: "@csb/dsh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin-src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var name = "csb-settings";
var inject = ["slots", "connection"];
var CSB_RPC_CHANNEL = "/csb";
var ENDPOINTS = Object.freeze({
  status: "csb.status",
  docsList: "csb.docs.list",
  docsGet: "csb.docs.get",
  verify: "csb.verify",
  serviceList: "csb.service.list",
  serviceStart: "csb.service.start",
  serviceStop: "csb.service.stop",
  memoryStatus: "csb.memory.status"
});
var h = React.createElement;
function unwrap(result) {
  if (!result || typeof result.ok !== "boolean") {
    throw new Error("\u78B3\u7845\u5951\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const err = new Error(result.error?.message ?? "\u78B3\u7845\u5951\u670D\u52A1\u8BF7\u6C42\u5931\u8D25");
    err.code = result.error?.code ?? "CSB_RPC_ERROR";
    throw err;
  }
  return result.value;
}
var styles = {
  section: { marginBottom: 18 },
  card: { border: "1px solid rgba(128,128,128,.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 10 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 13 },
  label: { color: "rgba(128,128,128,.85)" },
  ok: { color: "#3fb950", fontWeight: 600 },
  bad: { color: "#f85149", fontWeight: 600 },
  neutral: { color: "#d29922", fontWeight: 600 },
  title: { fontSize: 14, fontWeight: 600, margin: "0 0 8px" },
  docItem: { padding: "6px 10px", cursor: "pointer", borderRadius: 6, fontSize: 13 },
  docItemHover: { background: "rgba(128,128,128,.12)" },
  tabBar: { display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  tab: { padding: "4px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,.35)", background: "transparent", cursor: "pointer", fontSize: 12, color: "inherit" },
  tabActive: { padding: "4px 12px", borderRadius: 12, border: "1px solid rgba(128,128,128,.6)", background: "rgba(128,128,128,.18)", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "inherit" },
  pre: { maxHeight: 320, overflow: "auto", background: "rgba(0,0,0,.35)", border: "1px solid rgba(128,128,128,.2)", borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  btn: { padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(128,128,128,.4)", background: "rgba(128,128,128,.12)", cursor: "pointer", fontSize: 13, color: "inherit" },
  btnDanger: { padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(248,81,73,.5)", background: "rgba(248,81,73,.12)", cursor: "pointer", fontSize: 13, color: "#f85149" },
  error: { color: "#f85149", fontSize: 13 },
  muted: { color: "rgba(128,128,128,.7)", fontSize: 12 }
};
function Badge({ ok, text }) {
  return h("span", { style: ok ? styles.ok : ok === false ? styles.bad : styles.neutral }, text);
}
function Row({ label, value, badge }) {
  return h(
    "div",
    { style: styles.row },
    h("span", { style: styles.label }, label),
    badge ? h(Badge, { ok: badge.ok, text: badge.text }) : h("span", null, value ?? "\u2014")
  );
}
function StatusCard({ status, memory }) {
  if (!status) return h("div", { style: styles.card }, "\u52A0\u8F7D\u4E2D\u2026");
  const hs = status.handshake ?? {};
  const llm = status.llm ?? {};
  return h(
    "div",
    { style: styles.card },
    h("div", { style: styles.title }, "\u72B6\u6001"),
    h(Row, { label: "\u8EAB\u4EFD", value: status.aid?.agentId ?? status.name, badge: status.aid ? { ok: true, text: "AID" } : { ok: false, text: "\u65E0 AID" } }),
    h(Row, { label: "\u63E1\u624B\u7AEF\u70B9", badge: { ok: hs.enabled, text: hs.enabled ? "\u5DF2\u542F\u7528" : "\u672A\u542F\u7528" } }),
    h(Row, { label: "\u7528\u6237\u516C\u94A5", value: hs.userPubkeyKid ?? null, badge: { ok: hs.userPubkeyConfigured, text: hs.userPubkeyConfigured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E" } }),
    h(Row, { label: "\u6CE8\u518C\u8868", value: status.registry ? `${status.registry.ip}:${status.registry.port}` : null, badge: { ok: status.registry?.status === "up", text: status.registry?.status ?? "\u672A\u77E5" } }),
    h(Row, { label: "LLM", value: llm.model ?? null, badge: { ok: llm.configured, text: llm.configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E" } }),
    h(Row, { label: "CSB \u8BB0\u5FC6", value: memory?.sizeHuman ?? null, badge: { ok: memory?.configured, text: memory?.configured ? "\u53EF\u7528" : "\u672A\u53D1\u73B0" } }),
    h(Row, { label: "\u534F\u8BAE\u7248\u672C", value: status.csbProtocolVersion ?? null }),
    h("div", { style: styles.muted }, `\u63D2\u4EF6 v${status.pluginVersion ?? "?"} \xB7 \u670D\u52A1\u5668 ${status.server ?? ""}`)
  );
}
function ServicesPanel({ services, busy, onStart, onStop }) {
  return h(
    "div",
    { style: styles.card },
    h("div", { style: styles.title }, "\u670D\u52A1(\u72EC\u7ACB\u8FDB\u7A0B)"),
    !services ? h("div", null, "\u52A0\u8F7D\u4E2D\u2026") : services.map(
      (s) => h(
        "div",
        { key: s.id, style: { ...styles.row, gap: 8 } },
        h("span", { style: styles.label, flex: 1 }, `${s.name} (:${s.port})`),
        h(
          "span",
          null,
          h(Badge, { ok: s.reachable, text: s.reachable ? s.identity ?? "\u5728\u7EBF" : "\u79BB\u7EBF" }),
          s.handshakeEnabled !== null ? h("span", { style: styles.muted }, ` \u63E1\u624B:${s.handshakeEnabled ? "\u2705" : "\u274C"}`) : null,
          s.pid ? h("span", { style: styles.muted }, ` PID:${s.pid}`) : null
        ),
        h(
          "span",
          { style: { display: "flex", gap: 6 } },
          h("button", { style: styles.btn, onClick: () => onStart(s.id), disabled: busy }, "\u542F\u52A8"),
          h("button", { style: styles.btnDanger, onClick: () => onStop(s.id), disabled: busy }, "\u505C\u6B62")
        )
      )
    )
  );
}
function DocsPanel({ sections, activeSection, openFile, content, loading, onSelectSection, onOpen }) {
  const active = sections?.find((s) => s.id === activeSection);
  return h(
    "div",
    { style: styles.card },
    h("div", { style: styles.title }, "\u6587\u6863(\u534F\u8BAE/\u5BAA\u7AE0/\u8BB0\u5FC6/\u8BC4\u6D4B)"),
    sections ? h(
      "div",
      { style: styles.tabBar },
      sections.map(
        (s) => h("button", {
          key: s.id,
          style: s.id === activeSection ? styles.tabActive : styles.tab,
          onClick: () => onSelectSection(s.id)
        }, `${s.title} (${s.docs.length})`)
      )
    ) : null,
    !active ? h("div", null, "\u52A0\u8F7D\u4E2D\u2026") : active.docs.length === 0 ? h("div", { style: styles.muted }, "\u8BE5\u5206\u7C7B\u6682\u65E0\u6587\u6863") : active.docs.map(
      (d) => h(
        "div",
        {
          key: d.file,
          style: openFile === d.file ? { ...styles.docItem, ...styles.docItemHover } : styles.docItem,
          onMouseEnter: (e) => {
            e.currentTarget.style.background = "rgba(128,128,128,.12)";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.background = "transparent";
          },
          onClick: () => onOpen(activeSection, d.file)
        },
        h("span", null, "\u{1F4C4} "),
        h("span", null, d.title),
        h("span", { style: styles.muted }, `  (${d.file})`)
      )
    ),
    openFile ? h(
      "div",
      { style: { marginTop: 10 } },
      h("div", { style: { ...styles.title, fontSize: 13 } }, `${activeSection}/${openFile}`),
      content === null ? h("div", { style: styles.muted }, loading ? "\u52A0\u8F7D\u4E2D\u2026" : "") : h("pre", { style: styles.pre }, content)
    ) : null
  );
}
function VerifyPanel({ verify, busy, onRun }) {
  return h(
    "div",
    { style: styles.card },
    h("div", { style: styles.title }, "\u5B89\u5168\u81EA\u68C0"),
    h("button", { style: styles.btn, onClick: onRun, disabled: busy }, busy ? "\u81EA\u68C0\u4E2D\u2026" : "\u8FD0\u884C\u81EA\u68C0"),
    verify?.error ? h("div", { style: styles.error }, `\u81EA\u68C0\u5931\u8D25: ${verify.error}`) : null,
    verify?.checks ? h(
      "div",
      { style: { marginTop: 10 } },
      h(
        "div",
        null,
        "\u7ED3\u679C: ",
        h(Badge, { ok: verify.allPass, text: verify.allPass ? `\u5168\u90E8\u901A\u8FC7 (${verify.summary}/${verify.total})` : `${verify.summary}/${verify.total} \u901A\u8FC7` })
      ),
      verify.checks.map(
        (c) => h(
          "div",
          { key: c.id, style: { ...styles.row, padding: "3px 0" } },
          h("span", { style: styles.label }, `${c.id}. ${c.label}`),
          h("span", { style: { fontSize: 12, color: "rgba(128,128,128,.8)", textAlign: "right", maxWidth: "60%" } }, c.detail)
        )
      )
    ) : null
  );
}
function CsbPanel({ rpcCall }) {
  const [status, setStatus] = React.useState(null);
  const [memory, setMemory] = React.useState(null);
  const [services, setServices] = React.useState(null);
  const [sections, setSections] = React.useState(null);
  const [activeSection, setActiveSection] = React.useState("protocol");
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
          rpcCall(ENDPOINTS.memoryStatus, {}).then(unwrap).catch(() => null)
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
    return () => {
      cancelled = true;
    };
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
      setContent(`\u52A0\u8F7D\u5931\u8D25: ${e.message}`);
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
      setError(r.started ? null : `\u542F\u52A8\u63D0\u793A: ${r.message}`);
      await refreshServices();
    } catch (e) {
      setError(`\u542F\u52A8\u5931\u8D25: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const stopService = async (serviceId) => {
    setBusy(true);
    try {
      const r = await rpcCall(ENDPOINTS.serviceStop, { service: serviceId }).then(unwrap);
      setError(r.stopped ? null : `\u505C\u6B62\u63D0\u793A: ${r.message}`);
      await refreshServices();
    } catch (e) {
      setError(`\u505C\u6B62\u5931\u8D25: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  return h(
    "div",
    { style: { padding: "4px 0" } },
    error ? h("div", { style: styles.error }, `\u78B3\u7845\u5951\u63D0\u793A: ${error}`) : null,
    h("div", { style: styles.section }, h(StatusCard, { status, memory })),
    h("div", { style: styles.section }, h(ServicesPanel, { services, busy, onStart: startService, onStop: stopService })),
    h("div", { style: styles.section }, h(DocsPanel, { sections, activeSection, openFile, content, loading, onSelectSection: setActiveSection, onOpen: openDoc })),
    h("div", { style: styles.section }, h(VerifyPanel, { verify, busy, onRun: runVerify }))
  );
}
async function apply(ctx, config = {}) {
  const rpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(CSB_RPC_CHANNEL, endpoint, payload, signal);
  ctx.slots.inject(
    "settings.plugins.tab",
    () => ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: "csb",
        order: 30,
        label: () => "\u78B3\u7845\u5951 CSB",
        inject: () => ({ rpcCall })
      },
      CsbPanel
    )
  );
}

    return module.exports;
  }
});

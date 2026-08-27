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
var inject = ["slots", "connection", "locale"];
function CsbPanel() {
  return React.createElement(
    "div",
    null,
    React.createElement("h2", null, "\u78B3\u7845\u5951 CSB"),
    React.createElement("p", null, "\u72B6\u6001\u9762\u677F\u5EFA\u8BBE\u4E2D\uFF08M2\uFF09\u2014\u2014 AID / \u63E1\u624B\u7AEF\u70B9 / \u6CE8\u518C\u8868\u5FC3\u8DF3 / \u534F\u8BAE\u6587\u6863\u5C06\u5728\u6B64\u5C55\u793A\u3002"),
    React.createElement(
      "p",
      { style: { color: "#888", fontSize: 12 } },
      "@csb/dsh-plugin v0.1.0 \xB7 M1 \u9AA8\u67B6\u5DF2\u52A0\u8F7D"
    )
  );
}
async function apply(ctx, config = {}) {
  const t = (key) => key;
  ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
    name: "settings.plugins.tab",
    id: "csb",
    order: 30,
    label: () => t("\u78B3\u7845\u5951 CSB"),
    inject: () => ({})
  }, CsbPanel));
}

    return module.exports;
  }
});

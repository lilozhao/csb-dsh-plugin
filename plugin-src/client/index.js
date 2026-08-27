// @csb/dsh-plugin · client 侧设置页（M1 骨架）
//
// M2/M3：接入 /api/csb/status → 状态卡（AID / 握手 / 注册表 / 版本）
//        + /api/csb/docs → 协议文档树 + 自检按钮
// 注册方式参照 @xmanrui/dsh-im：注入 dsh-client-ui-slots 后
// 在 'settings.plugins.tab' 插槽注册设置页标签。

import * as React from 'react';

export const name = 'csb-settings';
export const inject = ['slots', 'connection', 'locale'];

function CsbPanel() {
  return React.createElement('div', null,
    React.createElement('h2', null, '碳硅契 CSB'),
    React.createElement('p', null, '状态面板建设中（M2）—— AID / 握手端点 / 注册表心跳 / 协议文档将在此展示。'),
    React.createElement('p', { style: { color: '#888', fontSize: 12 } },
      '@csb/dsh-plugin v0.1.0 · M1 骨架已加载'),
  );
}

export async function apply(ctx, config = {}) {
  const t = (key) => key; // M2 接入 locale 后替换为翻译器

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'csb',
    order: 30,
    label: () => t('碳硅契 CSB'),
    inject: () => ({}),
  }, CsbPanel));
}

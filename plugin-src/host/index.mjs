// @csb/dsh-plugin · host 侧 glue plugin（M1 骨架）
//
// 里程碑：
//   M1  骨架：可安装、可加载（本文件）
//   M2  /api/csb/status 状态路由 + /api/csb/docs 协议文档路由 + csb-security 集成
//   M3  client 设置页面板完善
//
// 设计原则：零侵入 —— 不改 server_v5 运行方式，只读状态 + 文档 + 自检；
//           Secret 只读环境变量（A2A_SECURITY_HANDSHAKE_*），不落插件配置。

export const name = 'csb-host';
export const inject = ['connection', 'webServer'];

export async function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('csb') : ctx.logger ?? console;

  // M1 骨架挂载点：M2 在此注册 /api/csb/status、/api/csb/docs、/api/csb/verify
  logger.info?.('[csb] host plugin mounted (M1 skeleton)');

  return Object.freeze({
    name,
    async dispose() {
      logger.info?.('[csb] host plugin disposed');
    },
  });
}

export async function createCsbHostPlugin() {
  return Object.freeze({ name, inject, apply });
}

// @csb/dsh-plugin · 包完整性校验（npm run check）
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname ?? '.', '..');
const errors = [];

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  errors.push('package.json 缺 dsh.bundle.patch 声明');
}
if (!pkg.dsh?.client?.inject?.length) {
  errors.push('package.json 缺 dsh.client.inject');
}
for (const f of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  try {
    await readFile(resolve(root, f));
  } catch {
    errors.push(`缺少构建产物 ${f} —— 先运行 npm run build`);
  }
}
if (errors.length) {
  console.error('❌ 校验失败:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('✅ @csb/dsh-plugin 包结构完整');

/**
 * A2A 远程命令 - skill.info
 * 获取指定技能的详细信息
 */

const fs = require('fs');
const path = require('path');

async function execute(params) {
  try {
    const { skill } = params;

    if (!skill) {
      return {
        success: false,
        error: 'Missing required parameter: skill'
      };
    }

    const workspacePath = process.env.WORKSPACE_PATH || '/home/node/.openclaw/workspace';
    const skillPath = path.join(workspacePath, 'skills', skill);
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    // 检查技能是否存在
    if (!fs.existsSync(skillPath)) {
      return {
        success: false,
        error: `Skill not found: ${skill}`
      };
    }

    // 读取 SKILL.md
    let readme = '';
    let hasReadme = false;
    if (fs.existsSync(skillMdPath)) {
      try {
        readme = fs.readFileSync(skillMdPath, 'utf8');
        hasReadme = true;
      } catch (e) {
        readme = 'Failed to read SKILL.md';
      }
    }

    // 获取目录结构
    let files = [];
    try {
      const items = fs.readdirSync(skillPath, { withFileTypes: true });
      files = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file'
      }));
    } catch (e) {
      files = [];
    }

    return {
      success: true,
      data: {
        name: skill,
        path: skillPath,
        hasReadme: hasReadme,
        readme: readme.substring(0, 2000), // 限制长度
        files: files,
        timestamp: Date.now()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { execute };

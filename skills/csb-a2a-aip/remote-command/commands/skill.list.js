/**
 * A2A 远程命令 - skill.list
 * 列出所有已安装的技能
 */

const fs = require('fs');
const path = require('path');

async function execute(params) {
  try {
    const workspacePath = process.env.WORKSPACE_PATH || '/home/node/.openclaw/workspace';
    const skillsPath = path.join(workspacePath, 'skills');

    // 检查目录是否存在
    if (!fs.existsSync(skillsPath)) {
      return {
        success: false,
        error: 'Skills directory not found: ' + skillsPath
      };
    }

    const items = fs.readdirSync(skillsPath, { withFileTypes: true });
    const skills = items
      .filter(item => item.isDirectory())
      .map(item => {
        const skillPath = path.join(skillsPath, item.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        
        let description = '';
        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf8');
            // 提取第一行作为描述
            const firstLine = content.split('\n')[0];
            description = firstLine.replace(/^#\s*/, '').substring(0, 100);
          } catch (e) {
            description = 'No description';
          }
        }

        return {
          name: item.name,
          description: description || 'No description'
        };
      });

    return {
      success: true,
      data: {
        count: skills.length,
        skills: skills
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

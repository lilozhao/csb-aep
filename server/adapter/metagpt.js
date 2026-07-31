/**
 * MetaGPT 适配器
 * 文件结构: MetaGPT 项目目录
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class MetaGPTAdapter extends BaseAdapter {
  constructor() { super('metagpt'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'config', 'config2.yaml')),
      soul: await r(path.join(agentPath, 'prompts', 'system.md')),
      user: await r(path.join(agentPath, 'user.md')),
      memory: await r(path.join(agentPath, 'workspace', 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'metagpt'; return b; }

  getBestPractices() { return [
    { category: 'MetaGPT 配置', items: [
      'config/config2.yaml 定义模型和角色',
      '支持多角色协作（产品经理、架构师、工程师等）',
      '内置 SOP（标准作业流程）',
      '支持代码生成和文档编写',
    ] },
  ]; }
}

module.exports = { MetaGPTAdapter };

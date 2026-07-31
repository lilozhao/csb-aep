/**
 * Pi Agent 适配器
 * Pi Agent (OpenClaw Pi Agent)
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class PiAgentAdapter extends BaseAdapter {
  constructor() { super('pi-agent'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'pi.json')),
      soul: await r(path.join(agentPath, 'PI.md')),
      user: await r(path.join(agentPath, 'USER.md')),
      memory: await r(path.join(agentPath, 'MEMORY.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'STATE.md')),
      heartbeat: await r(path.join(agentPath, 'HEARTBEAT.md')),
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'pi-agent'; return b; }

  getBestPractices() { return [
    { category: 'Pi Agent 配置', items: [
      'pi.json 定义 Agent 身份和端口',
      'PI.md 定义核心人格和行为准则',
      '支持 A2A 协议通信',
      '支持多模型切换',
    ] },
  ]; }
}

module.exports = { PiAgentAdapter };

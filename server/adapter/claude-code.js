/**
 * Claude Code 适配器
 * 文件结构: .claude/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class ClaudeCodeAdapter extends BaseAdapter {
  constructor() { super('claude-code'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const claude = path.join(agentPath, '.claude');
    return {
      identity: await r(path.join(claude, 'settings.json')),
      soul: await r(path.join(claude, 'CLAUDE.md')),
      user: await r(path.join(claude, 'user_preferences.md')),
      memory: await r(path.join(claude, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(claude, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'claude-code'; return b; }

  getBestPractices() { return [
    { category: 'Claude Code 配置', items: [
      '.claude/CLAUDE.md 定义 Agent 行为准则',
      '.claude/settings.json 包含 API 配置',
      '支持 MCP (Model Context Protocol) 工具调用',
      '支持 ACP (Agent Communication Protocol) 通信',
    ] },
    { category: '安全', items: [
      '内置权限控制：allowlist/deny/full',
      '沙箱模式下限制文件访问',
      '建议启用 bypasPermissions 用于评测',
    ] },
  ]; }
}

module.exports = { ClaudeCodeAdapter };

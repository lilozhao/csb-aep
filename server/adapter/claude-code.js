/**
 * Claude Code 适配器
 * 文件结构: .claude/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class ClaudeCodeAdapter extends BaseAdapter {
  constructor() {
    super('claude-code');
    // P1-1 采集器能力声明在 server/adapter/collector-registry.js（单一真源）。
    // 本适配器：permissionConfig=true（.claude/settings*.json 的 permissions），
    // 其余如实 false。改动能力请改 registry，并同步本文件的实现。
  }

  /**
   * S 类：权限配置（P1-1 实现）
   * 来源：.claude/settings.json 与 settings.local.json 的 permissions（allow/deny/ask）
   * 两文件合并：local 覆盖 project（与 Claude Code 自身语义一致）。
   * @returns {object|null}
   */
  async getPermissionConfig(agentPath) {
    const readJson = async (p) => {
      try { return JSON.parse(await fs.readFile(p, 'utf-8')); } catch { return null; }
    };
    const claude = path.join(agentPath, '.claude');
    const project = await readJson(path.join(claude, 'settings.json'));
    const local = await readJson(path.join(claude, 'settings.local.json'));
    if (!project && !local) return null;

    const merge = (k) => {
      const a = (project?.permissions?.[k]) || [];
      const b = (local?.permissions?.[k]) || [];
      const v = [...new Set([...a, ...b])];
      return v.length ? v : null;
    };
    return {
      trustLevel: null,             // Claude Code 无此概念，不臆造
      allowedCommands: merge('allow'),
      forbiddenActions: merge('deny'),
      askFirst: merge('ask'),
      defaultMode: project?.permissions?.defaultMode || local?.permissions?.defaultMode || null,
      source: local ? [path.join(claude, 'settings.json'), path.join(claude, 'settings.local.json')]
                    : path.join(claude, 'settings.json'),
    };
  }

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

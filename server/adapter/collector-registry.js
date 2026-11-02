/**
 * 采集器能力声明表（P1-1 · 2026-11-02）
 *
 * 为什么集中一张表，而不是散在 17 个适配器里：
 *   ① 审计要能「一眼看全」——17 个文件各写一半，没人能确认整体诚实度
 *   ② 判据要能「机械核对」——表里写 sources.x=true，测试就去调该适配器的方法验证它真能返回数据
 *   ③ 差异要能「被看见」——哪几个适配器能读权限、哪几个什么都读不到，一张表比 17 次翻文件清楚
 *
 * 两个概念（混在一起会得出错误结论）：
 *   tier    运行时能看见什么粒度 → 决定这条结论能不能判 FAIL（P0-6 档位天花板）
 *   sources 静态能从 Agent 文件读到什么 → 决定白盒/S 类安全项能查什么
 * 一个适配器可以静态全知、运行时全盲，也可以反之。
 *
 * 声明纪律：**true 必须有实现 + 有测试**。读不到就写 false，并在 reason 里说明为什么。
 * 宁可承认看不见，不要谎报看得见 —— 谎报会让上层判定链算出假结论。
 */

/** 运行时档位。全部适配器目前都走 A2A 黑盒往返 → protocol。 */
const TIER = Object.freeze({
  HOOK: 'hook',
  PROTOCOL: 'protocol',
  PTY: 'pty',
  NONE: 'none',
});

/**
 * 未声明时的统一理由（避免每个适配器重复写同样的废话）
 */
const NO_STRUCTURED = '配置文件里没有结构化的工具/权限清单，只有 prompt 与规则文本';

/**
 * 17 个适配器的采集能力。
 * evidence: 判据从哪里来 —— 写清楚才能被复核，不写就是自报。
 */
const COLLECTORS = {
  'openclaw': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: true, permissionConfig: true, injectionDefense: false, canary: false },
    sourcesReason: {
      injectionDefense: '注入防御写在 SOUL.md/AGENTS.md 的自然语言里，无结构化配置可读',
      canary: '需要真实执行与观测通道，本适配器只有文件读取与 A2A 往返',
    },
    evidence: 'openclaw.json → tools.*（7 项）+ agents.defaults.sandbox + approvals.exec',
    impl: ['getToolInventory', 'getPermissionConfig'],
  },

  'claude-code': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: true, injectionDefense: false, canary: false },
    sourcesReason: {
      toolInventory: 'MCP servers 与内置工具表分散在 settings*.json，无统一清单文件',
      injectionDefense: '无结构化注入防御配置；CLAUDE.md 是自然语言',
      canary: '需要真实执行与观测通道',
    },
    evidence: '.claude/settings.json + settings.local.json → permissions.{allow,deny,ask,defaultMode}',
    impl: ['getPermissionConfig'],
  },

  // ── 以下 15 个：只有 prompt/规则文件，没有结构化能力配置 ──────────────
  'aider': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { toolInventory: '.aider.conf.yml 是行为参数（auto-commits 等），不是工具清单', permissionConfig: '.aider.conf.yml 无权限模型' },
    evidence: '已读 .aider.conf.yml / CONVENTIONS.md，未发现工具或权限清单',
  },
  'auto-gpt': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { permissionConfig: 'ai_settings.yaml 的 DISABLED_COMMANDS 是行为开关，非权限模型；本机无样本可验' },
    evidence: 'ai_settings.yaml 结构未在本机验证 → 不声明为 true',
  },
  'cline': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: '.cline/config.json 为模型/行为配置',
  },
  'continue': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: '.continue/config.json 为 models/context providers 配置',
  },
  'coze': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { toolInventory: 'Coze 是云端托管 Bot，无本地文件可读', permissionConfig: 'Coze 权限在平台侧，本地不可见' },
    evidence: '本适配器 readAgentFiles 未实现（纯黑盒）',
  },
  'crewai': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { toolInventory: 'config/agents.yaml 的 tools 字段可读，但本机无样本验证 → 暂不声明' },
    evidence: '待样本验证后升级：agents.yaml:tools',
  },
  'cursor': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { permissionConfig: '.cursorrules 是规则文本，无权限模型' },
    evidence: '.cursor/config.json + .cursorrules 均为规则/行为配置',
  },
  'dify': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: 'dify.yaml + prompts/system.md',
  },
  'fastgpt': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: 'config.json 结构未在本机验证',
  },
  'generic-a2a': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { toolInventory: '兜底适配器，不读任何文件（纯 A2A 黑盒）', permissionConfig: '同上' },
    evidence: '本适配器无 readAgentFiles 实现',
  },
  'hermes': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: { toolInventory: '.hermes/identity.json 有 capabilities 字段，但不是工具清单' },
    evidence: '.hermes/ 下为身份与记忆文件',
  },
  'langchain': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: 'config.json + prompts/system.py',
  },
  'metagpt': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: 'config/config2.yaml + prompts/system.md',
  },
  'opencode': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: '.opencode/config.json 结构未在本机验证',
  },
  'pi-agent': {
    tier: TIER.PROTOCOL,
    tierReason: 'a2a_roundtrip',
    sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
    sourcesReason: NO_STRUCTURED,
    evidence: 'pi.json + PI.md',
  },
};

/** 取某适配器的声明（未注册的按最保守处理） */
function collectorFor(name) {
  const d = COLLECTORS[name];
  if (!d) {
    return {
      tier: TIER.NONE,
      tierReason: 'unregistered_collector',
      sources: { toolInventory: false, permissionConfig: false, injectionDefense: false, canary: false },
      sourcesReason: { toolInventory: '适配器未在 collector-registry 注册 → 按最保守处理' },
      evidence: null,
      impl: [],
      registered: false,
    };
  }
  return { ...d, registered: true };
}

module.exports = { COLLECTORS, TIER, collectorFor, NO_STRUCTURED };

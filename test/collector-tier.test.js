/**
 * P1-1 采集档位 + collector 元数据 —— 判据测试
 *
 * 守三件事：
 *   ① 17 个适配器全部在 collector-registry 注册（不许有"隐形适配器"）
 *   ② registry 里声明 sources.x=true 的，适配器必须**真有实现且真能读到数据**
 *      （用临时样本目录造，确定性验证；读不到就说明是谎报）
 *   ③ resolveTier 的 ceiling 语义：**只封上限，不抬下限**
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADAPTER_DIR = path.join(__dirname, '..', 'server', 'adapter');
const { BaseAdapter, COLLECTOR_TIER } = require(path.join(ADAPTER_DIR, 'base.js'));
const { COLLECTORS, TIER, collectorFor } = require(path.join(ADAPTER_DIR, 'collector-registry.js'));
const { resolveTier } = require('../server/engine/verdict');

/** 从目录里加载所有适配器实例（名字 → instance） */
function loadAdapters() {
  const out = {};
  for (const f of fs.readdirSync(ADAPTER_DIR)) {
    if (!f.endsWith('.js') || f === 'base.js' || f === 'collector-registry.js') continue;
    const mod = require(path.join(ADAPTER_DIR, f));
    for (const [exportName, Cls] of Object.entries(mod)) {
      if (typeof Cls !== 'function') continue;
      try {
        const inst = new Cls();
        out[inst.name] = inst;
      } catch (e) {
        assert.fail(`${f} 的 ${exportName} 实例化失败：${e.message}`);
      }
    }
  }
  return out;
}

const ADAPTERS = loadAdapters();
const NAMES = Object.keys(ADAPTERS);

// ── ① 注册完整性 ──────────────────────────────────────────────
test('17 个适配器全部实例化成功', () => {
  assert.ok(NAMES.length >= 17, `只加载到 ${NAMES.length} 个适配器：${NAMES.join(', ')}`);
});

test('每个适配器都在 collector-registry 里注册（无隐形适配器）', () => {
  const unregistered = NAMES.filter((n) => !COLLECTORS[n]);
  assert.deepStrictEqual(unregistered, [], `未注册：${unregistered.join(', ')}`);
});

test('registry 里的每一个 key 都有对应适配器实现（无幽灵条目）', () => {
  const ghost = Object.keys(COLLECTORS).filter((n) => !ADAPTERS[n]);
  assert.deepStrictEqual(ghost, [], `registry 有但代码无：${ghost.join(', ')}`);
});

// ── ② 声明必须可验证 ─────────────────────────────────────────
test('每种 tier 都是合法值', () => {
  for (const [name, d] of Object.entries(COLLECTORS)) {
    assert.ok(Object.values(TIER).includes(d.tier), `${name} 的 tier=${d.tier} 不合法`);
  }
});

test('sources 声明为 true 的，适配器必须真实现了对应方法（能返回数据）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-collector-'));
  // 造 openclaw 样本
  fs.writeFileSync(path.join(tmp, 'openclaw.json'), JSON.stringify({
    tools: { exec: { enabled: true }, fs: { enabled: true }, bad: { enabled: false } },
    approvals: { exec: { enabled: false } },
    agents: { defaults: { sandbox: { mode: 'off' } } },
  }), 'utf8');
  // 造 claude-code 样本
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm -rf)'], defaultMode: 'acceptEdits' },
  }), 'utf8');

  const checks = {
    'openclaw': async () => {
      const a = ADAPTERS['openclaw'];
      const inv = await a.getToolInventory(tmp);
      assert.ok(inv.length >= 2, `openclaw getToolInventory 返回 ${inv.length} 项，样本里有 3 个工具`);
      assert.ok(inv.some((t) => t.id === 'tool.exec' && t.dangerous === true), 'exec 应被标 dangerous');
      const perm = await a.getPermissionConfig(tmp);
      assert.ok(perm && perm.sandbox, 'openclaw getPermissionConfig 未读到 sandbox');
    },
    'claude-code': async () => {
      const a = ADAPTERS['claude-code'];
      const perm = await a.getPermissionConfig(tmp);
      assert.ok(perm, 'claude-code getPermissionConfig 返回 null');
      assert.deepStrictEqual(perm.allowedCommands, ['Bash(npm test)']);
      assert.deepStrictEqual(perm.forbiddenActions, ['Bash(rm -rf)']);
      assert.strictEqual(perm.defaultMode, 'acceptEdits');
    },
  };

  for (const [name, d] of Object.entries(COLLECTORS)) {
    for (const [field, claimed] of Object.entries(d.sources || {})) {
      if (!claimed) continue;
      // 目前只有 toolInventory / permissionConfig 有实现约定
      const method = field === 'toolInventory' ? 'getToolInventory'
        : field === 'permissionConfig' ? 'getPermissionConfig'
        : field === 'injectionDefense' ? 'getInjectionDefense'
        : field === 'canary' ? 'testCanary' : null;
      assert.ok(method, `${name}.sources.${field} 不是已知字段`);
      const a = ADAPTERS[name];
      assert.strictEqual(typeof a[method], 'function', `${name} 声明 ${field}=true 但没有 ${method}`);
      // base 的方法是 throw not implemented —— 覆盖后才是真实现
      assert.notStrictEqual(a[method], BaseAdapter.prototype[method], `${name}.${method} 只是继承基类的未实现版本，却声明为 true`);
      if (checks[name] && (field === 'toolInventory' || field === 'permissionConfig')) {
        await checks[name]();
      }
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('声明为 false 的字段必须留理由（不许空着）', () => {
  for (const [name, d] of Object.entries(COLLECTORS)) {
    for (const [field, claimed] of Object.entries(d.sources || {})) {
      if (claimed) continue;
      const reason = (d.sourcesReason || {})[field];
      // 允许用统一理由兜底（NO_STRUCTURED），但至少要有内容
      assert.ok(reason || (d.sourcesReason && Object.keys(d.sourcesReason).length),
        `${name}.sources.${field}=false 但没有给理由 —— 读者无法判断是"没有"还是"懒得做"`);
    }
  }
});

// ── ③ ceiling 语义 ───────────────────────────────────────────
test('无 ceiling 时行为与 P0-6 完全一致（向后兼容）', () => {
  assert.strictEqual(resolveTier({ hooks: true }).tier, TIER.HOOK);
  assert.strictEqual(resolveTier({ protocol: true }).tier, TIER.PROTOCOL);
  assert.strictEqual(resolveTier({ screen: true }).tier, TIER.PTY);
  assert.strictEqual(resolveTier({}).tier, TIER.NONE);
});

test('ceiling 只封上限：hook 证据 + protocol 上限 → protocol，且记下观测值', () => {
  const r = resolveTier({ hooks: true }, { ceiling: TIER.PROTOCOL });
  assert.strictEqual(r.tier, TIER.PROTOCOL);
  assert.strictEqual(r.reason, 'capped_by_collector');
  assert.strictEqual(r.observed, TIER.HOOK, '必须保留被封顶前的观测值，否则无法审计');
});

test('ceiling 不抬下限：protocol 证据 + hook 上限 → protocol（不许虚报）', () => {
  const r = resolveTier({ protocol: true }, { ceiling: TIER.HOOK });
  assert.strictEqual(r.tier, TIER.PROTOCOL);
  assert.strictEqual(r.reason, 'protocol_roundtrip');
  assert.strictEqual(r.observed, undefined, '没被封顶就不该有 observed 字段');
});

test('非法 ceiling 不影响结果（不静默改判）', () => {
  const r = resolveTier({ protocol: true }, { ceiling: 'bogus' });
  assert.strictEqual(r.tier, TIER.PROTOCOL);
});

// ── ④ 元数据接口 ─────────────────────────────────────────────
test('BaseAdapter.collectorMeta() 结构完整', () => {
  const a = new BaseAdapter('openclaw');
  const m = a.collectorMeta();
  assert.strictEqual(m.id, 'openclaw');
  assert.ok(Object.values(COLLECTOR_TIER).includes(m.tier));
  assert.strictEqual(typeof m.registered, 'boolean');
  assert.ok(m.sources && typeof m.sources === 'object');
});

test('未注册的适配器按最保守处理（none + registered=false）', () => {
  const a = new BaseAdapter('some-future-adapter');
  const m = a.collectorMeta();
  assert.strictEqual(m.tier, TIER.NONE);
  assert.strictEqual(m.registered, false);
  assert.strictEqual(m.sources.toolInventory, false);
});

test('registry 直查与实例声明一致（单一真源）', () => {
  for (const name of NAMES) {
    const declared = collectorFor(name);
    const inst = ADAPTERS[name].collectorMeta();
    assert.strictEqual(inst.tier, declared.tier, `${name} 实例 tier 与 registry 不一致`);
    assert.deepStrictEqual(inst.sources, declared.sources, `${name} 实例 sources 与 registry 不一致`);
  }
});

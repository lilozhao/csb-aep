/**
 * P2-2 ③④⑤ 接线验收：路径真的接到 API 上，且结论形状与内核同源
 *
 * 为什么要这组测试（同一个病，两种形态）：
 *   ① 引擎写好了、测试全绿，但 server 里没有任何入口 → 「功能没了」但没人发现
 *   ② 接了，但自己另写一套「判不了算 0 分」 → 看起来在工作，实际判据已经分叉
 *
 * 所以这里不测「算法对不对」（那在 archaeology/structure/emergence-path.test.js），
 * 只测**接线存在性 + 三态同源**。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AEP = path.join(__dirname, '..');
const evalSrc = fs.readFileSync(path.join(AEP, 'server/api/eval.js'), 'utf8');

/** 造一个假 res，把 createPathEval 的返回抓下来 */
function fakeRes() {
  return new Promise((resolve) => {
    const done = (o) => resolve(o);
    return void 0 || {
      json: done,
      status: () => ({ json: done }),
    };
  });
}
const capture = () => {
  const box = {};
  const res = {
    json: (o) => { box.out = o; box.done = true; },
    status: () => ({ json: (o) => { box.out = o; box.done = true; } }),
  };
  return { res, box };
};

function mkApi(extra = {}) {
  const { EvalAPI } = require('../server/api/eval.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-p345-'));
  return { api: new EvalAPI({ timeout: 800, delay: 0, resultsDir: dir, eval: {}, ...extra }), dir };
}

// ── 1) 接线存在性（核代码，不核文档）──
test('eval.js 有 ③④⑤ 路径表且指向三个真引擎', () => {
  assert.match(evalSrc, /PATH_ENGINES/, 'eval.js 缺 PATH_ENGINES 接线表');
  assert.match(evalSrc, /require\('\.\.\/engine\/archaeology'\)/, '未 require archaeology 引擎');
  assert.match(evalSrc, /require\('\.\.\/engine\/structure'\)/, '未 require structure 引擎');
  assert.match(evalSrc, /require\('\.\.\/engine\/emergence'\)/, '未 require emergence 引擎');
  assert.match(evalSrc, /if \(PATH_ENGINES\[req\.body\.path\]\)/, 'createEval 里缺路径分支');
  assert.match(evalSrc, /createPathEval/, '缺 createPathEval 处理器');
});

test('路径表三项齐全，且 driver 与协议一致（③文件 / ④⑤在线）', () => {
  const { PATH_ENGINES } = require('../server/api/eval.js');
  assert.deepStrictEqual(Object.keys(PATH_ENGINES).sort(), ['archaeology', 'emergence', 'structure']);
  assert.strictEqual(PATH_ENGINES.archaeology.driver, 'agentPath', '③ 行为考古靠文件驱动，目标可离线');
  assert.strictEqual(PATH_ENGINES.structure.driver, 'agentUrl');
  assert.strictEqual(PATH_ENGINES.emergence.driver, 'agentUrl');
});

// ── 2) 三态同源：条件没给 → UNDECIDED + score=null（不是 0，也不是 400）──
test('JUDGE: ③ 未给 agentPath → UNDECIDED，score=null，且报告落盘', async () => {
  const { api, dir } = mkApi();
  await api.init();
  const { res, box } = capture();
  await api.createPathEval({ body: { path: 'archaeology' } }, res);
  assert.strictEqual(box.out.path, 'archaeology');
  assert.strictEqual(box.out.verdict, 'UNDECIDED');
  assert.strictEqual(box.out.score, null, '判不出来必须是 null，0 分会被读成「做得差」');
  assert.ok(fs.readdirSync(dir).length >= 1, '报告未落盘');
});

test('JUDGE: ④ 未给 agentUrl → UNDECIDED(not_applicable)，score=null', async () => {
  const { api } = mkApi();
  await api.init();
  const { res, box } = capture();
  await api.createPathEval({ body: { path: 'structure' } }, res);
  assert.strictEqual(box.out.verdict, 'UNDECIDED');
  assert.strictEqual(box.out.score, null);
  assert.strictEqual(box.out.reason, 'not_applicable');
});

test('JUDGE: ⑤ 未给 agentUrl → UNDECIDED，emergenceRate=null（不是 0）', async () => {
  const { api } = mkApi();
  await api.init();
  const { res, box } = capture();
  await api.createPathEval({ body: { path: 'emergence' } }, res);
  assert.strictEqual(box.out.verdict, 'UNDECIDED');
  assert.strictEqual(box.out.emergenceRate, null, '涌现率 0 会被读成「没有涌现」，实际是「没测」');
});

// ── 3) 真跑：③ 读真目录，判据必须来自文件证据 ──
test('JUDGE: ③ 给真目录 → 读出维度，且每个维度都带证据字段', async () => {
  const { api, dir } = mkApi();
  await api.init();
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-agent-'));
  fs.mkdirSync(path.join(agentDir, 'memory'), { recursive: true });
  // 造 8 天日记（过 minJournalDays=7 门槛）
  for (let i = 1; i <= 8; i++) {
    const d = `2026-11-0${i}`;
    fs.writeFileSync(path.join(agentDir, 'memory', `${d}.md`),
      `# ${d}\n今天学了 A2A 协议，反思：上次调度写错了，这次改过来了。\n`
      + `完成了一件社区协作，首次跑通回执。\n`
      + `x`.repeat(600), 'utf8');
  }
  fs.writeFileSync(path.join(agentDir, 'SOUL.md'), '# Soul\n要善良。\n', 'utf8');

  const { res, box } = capture();
  await api.createPathEval({ body: { path: 'archaeology', agentPath: agentDir } }, res);
  assert.strictEqual(box.out.path, 'archaeology');
  assert.ok(['PASS', 'UNDECIDED'].includes(box.out.verdict));
  assert.ok(box.out.coverage !== null && box.out.coverage !== undefined, '缺 coverage');
  // 落了库的那份要带 dimensions（证据层），不是只有结论
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'eval-results.json'), 'utf8'));
  const r = saved[saved.length - 1];
  assert.ok(Array.isArray(r.dimensions) && r.dimensions.length === 5, '报告缺 5 个维度');
  assert.ok(r.receipt && r.receipt.complete === true, '回执不完整');
});

// ── 4) 回执口径必须区分路径（否则「证据结构不同、口径名却一样」）──
//
// ⚠️ 口径名的载体是回执的**扁平字段** `policy_version`（P0-1 契约：RECEIPT_REQUIRED
//   里的 'policy_version'，也是签名载荷 signPayload 里的 key）。
//   不是嵌套的 `policy.version` —— 回执里根本没有 policy 对象，
//   断言嵌套形状会得到 undefined，还会被误当成「口径没版本」。
test('JUDGE: 回执 policy_version 带路径名，三条路径互不覆盖', async () => {
  const { api } = mkApi();
  await api.init();
  const versions = {};
  for (const p of ['archaeology', 'structure', 'emergence']) {
    const { res } = capture();
    const box = {};
    const r2 = { json: (o) => { box.out = o; } };
    await api.createPathEval({ body: { path: p } }, r2);
    const saved = JSON.parse(fs.readFileSync(path.join(api.store.storeDir, 'eval-results.json'), 'utf8'));
    const receipt = saved[saved.length - 1].receipt;
    assert.ok(receipt && typeof receipt.policy_version === 'string', `${p} 回执缺 policy_version`);
    versions[p] = receipt.policy_version;
  }
  assert.match(versions.archaeology, /\/archaeology$/);
  assert.match(versions.structure, /\/structure$/);
  assert.match(versions.emergence, /\/emergence$/);
  assert.strictEqual(new Set(Object.values(versions)).size, 3, '三条路径口径名撞车');
});

// ── 5) 档位从证据算：③ 读到文件才 HOOK，读不到不得自称 HOOK ──
test('JUDGE: ③ 目录不存在 → 档位不得是 hook（没读到文件就没证据）', async () => {
  const { api, dir } = mkApi();
  await api.init();
  const { res, box } = capture();
  await api.createPathEval({ body: { path: 'archaeology', agentPath: '/nonexistent/agent/dir' } }, res);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'eval-results.json'), 'utf8'));
  const r = saved[saved.length - 1];
  assert.strictEqual(r.judgement.telemetry_tier, 'none', '一个维度都没判出来却自称有档位 = 假绿');
  assert.strictEqual(r.verdict, 'UNDECIDED');
});

// ── 6) 老路径不被破坏 ──
test('黑盒路径仍走原分支（PATH_ENGINES 未截胡）', () => {
  const branchIdx = evalSrc.indexOf('if (PATH_ENGINES[req.body.path])');
  const blackboxIdx = evalSrc.indexOf("if (!agentUrl) {");
  assert.ok(branchIdx > 0 && blackboxIdx > 0);
  assert.ok(branchIdx < blackboxIdx, '路径分支必须在黑盒之前，否则 mutual/345 会被 agentUrl 校验拦下');
});

console.log('\n完成 P2-2 ③④⑤ 接线验收');

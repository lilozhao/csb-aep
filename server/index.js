/**
 * CSB-AEP v2.0 - Agent 质量评估平台
 * 主入口
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { EvalAPI } = require('./api/eval');
const { GdiAPI } = require('./api/gdi'); // v2.3 关系 GDI 观测域（与评测域隔离，红线第 6 条）
const { HarnessAPI } = require('./api/harness'); // v2.4 Harness 工程域（与评测域/GDI 域隔离，协议 §7）
const config = require('../config/defaults.json');

// ── P0-2 修复（2026-10-24 · 明鉴评审）────────────────────────────────────
// 旧行为：server.listen(port, '0.0.0.0') + 全部接口无鉴权 + 内置 redteam 引擎
//（样本库本身就是 curl|bash 类攻击载荷）。暴露在不可信网段时可能被当「借刀」：
// 指定任意第三方 Agent 发起攻击性评测，出事算发起方的。
// 新行为（fail-closed）：
//   1. 默认只监听 127.0.0.1；要对外必须显式 AEP_HOST=0.0.0.0 或具体 IP
//   2. 一旦监听非回环地址 → **强制要求** AEP_API_TOKEN，否则拒绝启动
//   3. 带 token 时所有 /api/* 需要 Authorization: Bearer <token>（用 timingSafeEqual 比对）
//   4. redteam 类接口额外白名单：只允许 AEP_REDTEAM_ALLOWLIST 登记的 agent
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopback(host) {
  return LOOPBACK.has(String(host || '').toLowerCase());
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 从请求里取 token（Authorization: Bearer x 或 X-AEP-Token） */
function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return (req.headers['x-aep-token'] || '').trim();
}

// 简易路由
function createRouter() {
  const routes = { GET: [], POST: [] };

  const app = {
    get: (path, handler) => routes.GET.push({ path, handler }),
    post: (path, handler) => routes.POST.push({ path, handler }),
    handle: (req, res) => {
      const method = req.method.toUpperCase();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // JSON helper
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };

      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-AEP-Token');
      if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      // ── P0-2：/api/* 鉴权（配置了 AEP_API_TOKEN 时强制执行）──────────
      // 静态页与健康探测放行，避免监控/自检被挡；数据与执行类接口一律要 token。
      const openPaths = new Set(['/api/health', '/api/gdi/health', '/api/harness/health']);
      if (pathname.startsWith('/api/') && !openPaths.has(pathname)) {
        const needToken = process.env.AEP_API_TOKEN;
        if (needToken) {
          const got = extractToken(req);
          if (!got || !safeEqual(got, needToken)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized', hint: '需要 Authorization: Bearer <AEP_API_TOKEN>' }));
            return;
          }
        }
      }

      // 解析 body
      if (method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try { req.body = JSON.parse(body); } catch { req.body = {}; }
          dispatch(method, pathname, req, res);
        });
      } else {
        dispatch(method, pathname, req, res);
      }
    }
  };

  function dispatch(method, pathname, req, res) {
    for (const route of routes[method] || []) {
      const match = matchPath(route.path, pathname);
      if (match) {
        req.params = match;
        return route.handler(req, res);
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  function matchPath(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) return null;
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  }

  return app;
}

async function main() {
  const app = createRouter();
  const api = new EvalAPI(config);
  await api.init();
  api.register(app);

  // v2.3 关系 GDI 观测域：独立实例 + 独立路由前缀（/api/gdi/*），与评测域物理隔离
  const gdiApi = new GdiAPI(config);
  gdiApi.register(app);

  // v2.4 Harness 工程域：独立实例 + 独立路由前缀（/api/harness/*），与评测域/GDI 域隔离（协议 §7）
  const harnessApi = new HarnessAPI(config);
  harnessApi.register(app);

  // 静态文件服务
  const fs = require('fs');
  const webDir = path.join(__dirname, '../web');

  app.get('/', (req, res) => {
    try {
      const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('Web UI not found');
    }
  });

  // 启动服务器
  const server = http.createServer(app.handle);
  const port = process.env.AEP_PORT || config.port || 3200;

  // ── P0-2：默认只听回环；对外必须显式 + 必须有 token ──────────────────
  const host = process.env.AEP_HOST || DEFAULT_HOST;
  if (!isLoopback(host) && !process.env.AEP_API_TOKEN) {
    console.error(`❌ 拒绝启动：AEP_HOST=${host} 表示对外监听，但没有设置 AEP_API_TOKEN。`);
    console.error('   aep 含 redteam 引擎（样本即攻击载荷），对不可信网络开放必须鉴权。');
    console.error('   · 只本机用：unset AEP_HOST（默认 127.0.0.1）');
    console.error('   · 需对外：export AEP_HOST=0.0.0.0 且 export AEP_API_TOKEN=$(openssl rand -hex 32)');
    process.exit(1);
  }

  server.listen(port, host, () => {
    let version = '2.x';
    try { version = require('../package.json').version; } catch { /* ignore */ }
    console.log(`\n🚀 CSB-AEP v${version} 已启动（含 v2.3 GDI 观测域 /api/gdi/* · v2.4 Harness 工程域 /api/harness/*）`);
    console.log(`   监听: ${host}:${port}${isLoopback(host) ? '（仅本机）' : '（⚠️ 对外）'}`);
    console.log(`   鉴权: ${process.env.AEP_API_TOKEN ? '✅ 已启用（Bearer token）' : '— 未启用（仅回环可接受）'}`);
    console.log(`   API: http://localhost:${port}/api/health`);
    console.log(`   GDI: http://localhost:${port}/api/gdi/health`);
    console.log(`   Harness: http://localhost:${port}/api/harness/health`);
    console.log(`   Web: http://localhost:${port}/`);
    if (!isLoopback(host)) {
      console.log(`   ⚠️ 红队白名单：${process.env.AEP_REDTEAM_ALLOWLIST || '（未配置 → 拒绝所有未登记目标）'}`);
    }
    console.log('');
  });
}

main().catch(e => {
  console.error('❌ 启动失败:', e.message);
  process.exit(1);
});

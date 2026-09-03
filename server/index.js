/**
 * CSB-AEP v2.0 - Agent 质量评估平台
 * 主入口
 */
const http = require('http');
const path = require('path');
const { EvalAPI } = require('./api/eval');
const { GdiAPI } = require('./api/gdi'); // v2.3 关系 GDI 观测域（与评测域隔离，红线第 6 条）
const config = require('../config/defaults.json');

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

  server.listen(port, '0.0.0.0', () => {
    let version = '2.x';
    try { version = require('../package.json').version; } catch { /* ignore */ }
    console.log(`\n🚀 CSB-AEP v${version} 已启动（含 v2.3 GDI 观测域 /api/gdi/*）`);
    console.log(`   端口: ${port}`);
    console.log(`   API: http://localhost:${port}/api/health`);
    console.log(`   GDI: http://localhost:${port}/api/gdi/health`);
    console.log(`   Web: http://localhost:${port}/`);
    console.log('');
  });
}

main().catch(e => {
  console.error('❌ 启动失败:', e.message);
  process.exit(1);
});

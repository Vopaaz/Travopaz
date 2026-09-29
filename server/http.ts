import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleRoutes } from './routes';

async function jsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16000) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

export async function startServer({
  root,
  port = 5173,
  dev = false,
  key = () => process.env.GOOGLE_MAPS_API_KEY,
}: {
  root: string;
  port?: number;
  dev?: boolean;
  key?: () => string | undefined;
}) {
  const routes = new GoogleRoutes(key);
  let vite: import('vite').ViteDevServer | null = null;
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
        return json(res, { error: '仅允许 localhost 访问' }, 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return json(res, { error: '拒绝跨站请求' }, 403);
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname === '/api/health')
        return json(res, { ok: true, routingConfigured: routes.configured() });
      if (url.pathname === '/api/routes' && req.method === 'POST')
        return json(res, await routes.lookup(await jsonBody(req)));
      if (url.pathname === '/api/routes/clear' && req.method === 'POST') {
        routes.clear();
        return json(res, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) return json(res, { error: '不存在的接口' }, 404);
      if (vite) {
        vite.middlewares(req, res);
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(root, 'dist', `.${decoded === '/' ? '/index.html' : decoded}`);
      const base = path.resolve(root, 'dist') + path.sep;
      if (!file.startsWith(base)) return json(res, { error: '路径无效' }, 400);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      };
      try {
        const bytes = await readFile(file);
        res.writeHead(200, {
          'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        });
        res.end(bytes);
      } catch {
        json(res, { error: '资源不存在' }, 404);
      }
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : '请求失败' }, 400);
    }
  });
  if (dev)
    vite = await (
      await import('vite')
    ).createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, vite, port: (server.address() as { port: number }).port };
}

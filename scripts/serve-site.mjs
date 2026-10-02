import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';

const root = await realpath(resolve('dist'));
const port = Number(process.env.PORT || 8081);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = await realpath(resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`));
    const inside = relative(root, path);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Outside public directory');
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`RecSeason preview: http://127.0.0.1:${port}/?emulator=1`));

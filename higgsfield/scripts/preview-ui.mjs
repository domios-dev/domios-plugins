// Parent-owned dev preview only; never imported by production or plugin build.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const port = args[0] === '--port' && /^\d{4,5}$/.test(args[1] ?? '') ? Number(args[1]) : 4179;
const bundle = await build({ absWorkingDir: root, entryPoints: ['higgsfield/ui/dev/main.tsx'], bundle: true, write: false, outdir: 'fixture-output', format: 'esm', platform: 'browser' });
const files = new Map(bundle.outputFiles.map(f => [f.path.endsWith('.css') ? '/app.css' : '/app.js', f.contents]));
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Higgsfield source fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  else if (files.has(path)) { res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(files.get(path)); }
  else if (['/fixtures/checker.png', '/fixtures/tone.wav'].includes(path)) {
    res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'audio/wav');
    res.end(await readFile(new URL('../ui/dev' + path, import.meta.url)));
  } else if (path === '/fixtures/synthetic-selection-4s.webm') {
    const bytes = await readFile(new URL('../ui/dev/fixtures/synthetic-selection-4s.webm', import.meta.url));
    res.setHeader('Content-Type', 'video/webm'); res.setHeader('Accept-Ranges', 'bytes');
    const header = req.headers.range;
    if (header) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(header);
      const start = match ? Number(match[1]) : NaN, end = match && match[2] ? Number(match[2]) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= bytes.length || end < start) { res.statusCode=416; res.setHeader('Content-Range', `bytes */${bytes.length}`); res.end(); return; }
      const last=Math.min(end,bytes.length-1); res.statusCode=206; res.setHeader('Content-Range', `bytes ${start}-${last}/${bytes.length}`); res.setHeader('Content-Length', last-start+1); res.end(bytes.subarray(start,last+1));
    } else { res.setHeader('Content-Length', bytes.length); res.end(bytes); }
  } else { res.statusCode = 404; res.end(); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Source fixtures only: http://127.0.0.1:${port}\n`));

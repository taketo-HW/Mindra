// Mindra の補助プログラム（任意）。127.0.0.1 だけで待ち受ける。使うときだけ起動する: npm run bridge
// 役割:
//   1. このページ（HTML / CSS / JS）を配信する（http://127.0.0.1:7777/）
//   2. .md ファイルを読み書きする（GET/PUT /file?path=絶対パス）。.md 以外は扱わない
//   3. AI チャットの橋渡し（POST /chat）: Claude / Codex の CLI、Ollama を呼ぶ
// 注意:
//   - 許可するのは、このページからの呼び出しだけ（file:// か localhost）
//   - Claude / Codex は、作業フォルダの外（一時フォルダ）で、読み取り専用で動かす
//   - 追加の依存はなし（Node 標準だけ）

import http from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, extname, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MINDRA_BRIDGE_PORT || 7777);
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const TIMEOUT_MS = 180_000;
const MAX_CONTEXT = 200_000;

// ページとして配信するファイル（作業フォルダの中の、この一覧だけ）。
const PAGE_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/src/parse.js': ['src/parse.js', 'text/javascript; charset=utf-8'],
  '/src/render.js': ['src/render.js', 'text/javascript; charset=utf-8'],
  '/src/watch.js': ['src/watch.js', 'text/javascript; charset=utf-8'],
  '/src/edit.js': ['src/edit.js', 'text/javascript; charset=utf-8'],
  '/src/app.js': ['src/app.js', 'text/javascript; charset=utf-8'],
};

// 呼び出してよい元（file:// は "null"、ローカルのページは localhost）。
function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'null') return 'null';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

// ---- AI ----

function buildPrompt(message, context, focus) {
  const map = context
    ? `The user is working on a Markdown file, shown as a mind map in the app. Its current content is below. Use only this content; do not search the filesystem for the file.\n\n\`\`\`markdown\n${context.slice(0, MAX_CONTEXT)}\n\`\`\`\n\n`
    : '';
  const part = focus ? `The user has attached this part of the file: ${focus.slice(0, 1000)}\n\n` : '';
  const rule = context
    ? 'If you propose changes to the file, put the complete new file content in one ```markdown code block. Do not write to any file yourself.\n\n'
    : '';
  return `${rule}${map}${part}User: ${message}`;
}

// CLI を、標準入力にプロンプトを渡して動かす（シェルは使わない）。
function runCli(command, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${command} could not start: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(out.trim());
      else reject(new Error(`${command} exited with ${code}: ${err.trim().slice(0, 500)}`));
    });
    child.stdin.end(input);
  });
}

async function askOllama(prompt) {
  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  const model = process.env.OLLAMA_MODEL || tags.models?.[0]?.name;
  if (!model) throw new Error('Ollama has no models. Pull one first (for example: ollama pull qwen3).');
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ollama returned ${res.status}`);
  return data.message.content.trim();
}

async function ask(ai, message, context, focus) {
  const prompt = buildPrompt(message, context, focus);
  if (ai === 'claude') return runCli('claude', ['-p'], prompt);
  if (ai === 'codex') return runCli('codex', ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], prompt);
  if (ai === 'ollama') return askOllama(prompt);
  throw new Error(`unknown AI: ${ai}`);
}

// 題名から、ファイル名を作る（使えない記号は _ にする）。
function fileNameFrom(title) {
  const base = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 80);
  return `${base || 'untitled'}.md`;
}

// ---- files (.md only, absolute path) ----

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// パスは絶対パスで、拡張子が .md のファイルだけ。
function checkedPath(raw) {
  if (typeof raw !== 'string' || !raw) throw new HttpError(400, 'path is required');
  if (!isAbsolute(raw)) throw new HttpError(400, 'path must be absolute');
  if (extname(raw).toLowerCase() !== '.md') throw new HttpError(400, 'only .md files can be opened');
  return raw;
}

async function readMd(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new HttpError(404, 'not a file');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(404, `cannot read ${path}`);
  }
  return readFile(path, 'utf8');
}

// ---- HTTP ----

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

const server = http.createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  if (req.headers.origin && !origin) {
    res.writeHead(403).end('origin not allowed');
    return;
  }
  const cors = {
    'Access-Control-Allow-Origin': origin ?? 'null',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (status, headers, body) => res.writeHead(status, { ...cors, ...headers }).end(body);
  const sendJson = (status, data) => send(status, JSON_HEADERS, JSON.stringify(data));
  const fail = (err) => {
    if (err instanceof HttpError) sendJson(err.status, { error: err.message });
    else sendJson(500, { error: err.message });
  };

  try {
    if (req.method === 'OPTIONS') return send(204, {}, '');
    if (req.method === 'GET' && url.pathname === '/favicon.ico') return send(204, {}, '');
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { 'Content-Type': 'text/plain' }, 'ok');

    if (req.method === 'GET' && PAGE_FILES[url.pathname]) {
      const [file, type] = PAGE_FILES[url.pathname];
      return send(200, { 'Content-Type': type }, await readFile(join(ROOT, file)));
    }

    if (url.pathname === '/file') {
      const path = checkedPath(url.searchParams.get('path'));
      if (req.method === 'GET') return sendJson(200, { text: await readMd(path) });
      if (req.method === 'PUT') {
        const { expected, text } = JSON.parse(await readBody(req));
        if (typeof text !== 'string') throw new HttpError(400, 'text is required');
        // 画面が読んだあとに、ファイルが変わっていたら書かない。
        if ((await readMd(path)) !== expected) throw new HttpError(409, 'the file changed outside the app');
        await writeFile(path, text, 'utf8');
        return sendJson(200, { ok: true });
      }
    }

    // 作業フォルダに、新しいマインドマップ（.md）を作る。同じ名前があれば上書きせず止める。
    if (req.method === 'POST' && url.pathname === '/new-file') {
      const { dir, title, text } = JSON.parse(await readBody(req));
      if (typeof dir !== 'string' || !isAbsolute(dir)) throw new HttpError(400, 'dir must be an absolute path');
      if (typeof text !== 'string') throw new HttpError(400, 'text is required');
      const info = await stat(dir).catch(() => null);
      if (!info || !info.isDirectory()) throw new HttpError(400, 'dir is not a folder');
      const name = fileNameFrom(title);
      const path = join(dir, name);
      try {
        await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
      } catch (err) {
        if (err.code === 'EEXIST') throw new HttpError(409, `${name} already exists`);
        throw err;
      }
      return sendJson(200, { path });
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      const { ai, message, context, focus } = JSON.parse(await readBody(req));
      if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'empty message');
      const reply = await ask(ai, message, typeof context === 'string' ? context : '', typeof focus === 'string' ? focus : '');
      return sendJson(200, { reply });
    }

    return send(404, { 'Content-Type': 'text/plain' }, 'not found');
  } catch (err) {
    fail(err);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Mindra bridge is already running on http://127.0.0.1:${PORT}. Nothing to do.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mindra bridge: http://127.0.0.1:${PORT}/  (pages, .md files, AI chat). Stop with Ctrl+C.`);
});

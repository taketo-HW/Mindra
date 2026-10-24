import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 補助プログラムを、テスト用のポートで起動して確かめる。
const PORT = 7791;
const BASE = `http://127.0.0.1:${PORT}`;
const BRIDGE = fileURLToPath(new URL('../tools/ai-bridge.mjs', import.meta.url));
let child;
let dir;

before(async () => {
  child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, MINDRA_BRIDGE_PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  dir = await mkdtemp(join(tmpdir(), 'mindra-test-'));
});

after(() => child && child.kill());

const fileUrl = (path) => `${BASE}/file?path=${encodeURIComponent(path)}`;

test('ページを配信する', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Mindra/);
});

test('相対パスと .md 以外は開けない', async () => {
  assert.equal((await fetch(fileUrl('trip.md'))).status, 400);
  assert.equal((await fetch(fileUrl(join(dir, 'note.txt')))).status, 400);
});

test('.md を読む', async () => {
  const path = join(dir, 'trip.md');
  await writeFile(path, '# Trip\n- a\n', 'utf8');
  const res = await fetch(fileUrl(path));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, '# Trip\n- a\n');
});

test('書くときは、読んだ内容と同じ場合だけ書く', async () => {
  const path = join(dir, 'write.md');
  await writeFile(path, 'old\n', 'utf8');
  const put = (expected, text) =>
    fetch(fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected, text }),
    });
  assert.equal((await put('changed elsewhere\n', 'new\n')).status, 409);
  assert.equal(await readFile(path, 'utf8'), 'old\n');
  assert.equal((await put('old\n', 'new\n')).status, 200);
  assert.equal(await readFile(path, 'utf8'), 'new\n');
});

test('許可されていない元からは呼べない', async () => {
  const res = await fetch(`${BASE}/health`, { headers: { Origin: 'https://example.com' } });
  assert.equal(res.status, 403);
});

test('作業フォルダに新しい .md を作る。同じ名前は上書きしない', async () => {
  const post = (body) =>
    fetch(`${BASE}/new-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await post({ dir, title: '宇宙開発: 概要', text: '# 宇宙開発\n' });
  assert.equal(first.status, 200);
  const { path } = await first.json();
  assert.equal(path, join(dir, '宇宙開発_ 概要.md'));
  assert.equal(await readFile(path, 'utf8'), '# 宇宙開発\n');
  assert.equal((await post({ dir, title: '宇宙開発: 概要', text: 'other' })).status, 409);
  assert.equal(await readFile(path, 'utf8'), '# 宇宙開発\n');
});

test('作業フォルダは絶対パスで、フォルダでなければならない', async () => {
  const post = (d) =>
    fetch(`${BASE}/new-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: d, title: 'x', text: 'x' }) });
  assert.equal((await post('relative')).status, 400);
  assert.equal((await post(join(dir, 'missing'))).status, 400);
});

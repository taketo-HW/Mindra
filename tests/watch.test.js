import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザの File System Access API を、偽のファイルハンドルで置き換えて試す。
const fakeHandle = (name, text) => {
  const handle = {
    name,
    text,
    async getFile() {
      const current = handle.text;
      return { text: async () => current, arrayBuffer: async () => new TextEncoder().encode(current).buffer };
    },
    async createWritable() {
      return {
        async write(data) {
          handle.text = data;
        },
        async close() {},
      };
    },
  };
  return handle;
};

const load = (handle) => {
  const ctx = vm.createContext({ setTimeout, clearTimeout, TextDecoder, showOpenFilePicker: async () => [handle] });
  for (const file of ['../src/parse.js', '../src/edit.js', '../src/watch.js']) {
    vm.runInContext(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'), ctx);
  }
  return ctx.Mindra;
};

const find = (tree, label) => {
  if (tree.text === label) return tree;
  for (const child of tree.children) {
    const found = find(child, label);
    if (found) return found;
  }
  return null;
};

test('監視中のファイルに書き戻すと、ファイルと表示の両方が新しくなる', async () => {
  const handle = fakeHandle('memo.md', '# R\n- a\n');
  const M = load(handle);
  const seen = [];
  const watcher = await M.watchFile((text) => seen.push(text));
  const node = find(M.parseMarkdown(handle.text, 'memo').root, 'a');

  const result = await watcher.edit((text) => M.addChild(text, node, '新しい項目'));
  watcher.stop();

  assert.equal(result.error, undefined);
  assert.equal(handle.text, '# R\n- a\n  - 新しい項目\n');
  assert.equal(seen.at(-1), '# R\n- a\n  - 新しい項目\n');
});

test('ファイルが外で変わっていたら、書き戻さずに失敗する', async () => {
  const handle = fakeHandle('memo.md', '# R\n- a\n');
  const M = load(handle);
  const watcher = await M.watchFile(() => {});
  const node = find(M.parseMarkdown(handle.text, 'memo').root, 'a');

  // 画面を開いたあとに、AI などが書き換えた場合。
  handle.text = '# R\n- z\n';
  const result = await watcher.edit((text) => M.renameNode(text, node, '新'));
  watcher.stop();

  assert.match(result.error, /changed outside/);
  assert.equal(handle.text, '# R\n- z\n');
});

test('対象の行が同じでも、ファイルの他の部分が外で変わっていたら書かない', async () => {
  const handle = fakeHandle('memo.md', '# R\n- a\n- b\n');
  const M = load(handle);
  const watcher = await M.watchFile(() => {});
  const node = find(M.parseMarkdown(handle.text, 'memo').root, 'a');

  handle.text = '# R\n- a\n- b\n- c\n';
  const result = await watcher.edit((text) => M.renameNode(text, node, '新'));
  watcher.stop();

  assert.match(result.error, /changed outside/);
  assert.equal(handle.text, '# R\n- a\n- b\n- c\n');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザ用の通常スクリプトを、vm の中で読み込む（読み取りの部分だけを試す）。
const ctx = vm.createContext({});
for (const file of ['src/parse.js', 'src/view-kit.js', 'src/view-orgchart.js']) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (view, body) => `---\nview: ${view}\n---\n${body}`;

const parse = (body) => j(M.views.orgchart.parse(doc('orgchart', body), 'x.md'));

test('組織図: 仕様の例を、見出しと箇条書きの木にする', () => {
  assert.deepEqual(parse('# 社長\n\n## 開発部\n- 設計課\n- 実装課\n## 営業部\n- 国内課\n'), {
    title: '社長',
    roots: [
      {
        text: '社長',
        children: [
          { text: '開発部', children: [{ text: '設計課', children: [] }, { text: '実装課', children: [] }] },
          { text: '営業部', children: [{ text: '国内課', children: [] }] },
        ],
      },
    ],
  });
});

test('組織図: 字下げした箇条書きは、さらに下の段になる', () => {
  const model = parse('# 社長\n\n- 開発部\n  - 設計課\n    - 一係\n');
  assert.deepEqual(model.roots[0].children[0].children[0].children, [{ text: '一係', children: [] }]);
});

test('組織図: 空の文書は、根が無い', () => {
  const model = parse('');
  assert.equal(model.title, 'x.md');
  assert.ok(Array.isArray(model.roots));
});

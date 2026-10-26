#!/usr/bin/env node
// .md を、表示専用の 1 枚の HTML（マインドマップ）に書き出す。
//   node tools/export-html.mjs <in.md> <out.html>
//   node tools/export-html.mjs <in.md>            … Orca のチャット用（ORCA_CHAT_SCRATCH_DIR に保存）
// Orca 用のときは、返信に貼る行（::orca-visual{...}）を表示する。
// 画面の描画は、アプリと同じ src/parse.js と src/render.js、styles.css を埋め込んで使う。
// 外部への通信はしない（すべて HTML の中に入れる）。

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// <script> の中に入れても、途中で閉じないようにする。
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

export async function buildHtml(markdown, title) {
  // 描画の部品（アプリと同じもの）。index.html のスクリプトの一覧から、画面の配線（読み書き・操作）以外を使う。
  const page = await readFile(join(ROOT, 'index.html'), 'utf8');
  const SCRIPTS = [...page.matchAll(/<script src="(src\/[a-z0-9-]+\.js)"><\/script>/g)]
    .map((m) => m[1])
    .filter((file) => !['src/watch.js', 'src/edit.js', 'src/app.js'].includes(file));
  const [css, ...scripts] = await Promise.all([
    readFile(join(ROOT, 'styles.css'), 'utf8'),
    ...SCRIPTS.map((file) => readFile(join(ROOT, file), 'utf8')),
  ]);
  const data = safeScript(JSON.stringify({ markdown, title }));
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&>"]/g, '')}</title>
<style>
${css}
/* 表示専用: アプリの画面の作りを外し、図だけを、中身の大きさで表示する */
body { height: auto; display: block; background: transparent; }
.export-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px 0; font-size: 13px; color: var(--muted); }
.export-bar strong { color: var(--fg); margin-right: auto; }
.export-bar button { padding: 2px 10px; border: 1px solid var(--control-border); border-radius: 4px; background: var(--panel); color: var(--fg); font: inherit; cursor: pointer; }
.export-bar button.is-on { border-color: var(--accent); color: var(--accent); }
.view { overflow-x: auto; overflow-y: hidden; padding: 12px; }
.mm-tools .mm-add, .mm-tools .mm-star { display: none !important; }
.mm-label { cursor: default; }
.mm-label:hover { box-shadow: none; }
</style>
</head>
<body>
<div class="export-bar"><strong id="title"></strong><button id="fit" type="button" class="is-on">Fit</button><button id="full" type="button">100%</button></div>
<main id="view" class="view"></main>
${scripts.map((code) => `<script>${safeScript(code)}</script>`).join('\n')}
<script>
(function () {
  var data = ${data};
  // 表示する場所（Orca など）の背景が暗ければ、暗いテーマにする。
  function isDark() {
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    if (bg) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      var g = c.getContext('2d');
      g.fillStyle = '#123456'; // 色として読めなかったかを見分けるための印
      g.fillStyle = bg;
      if (g.fillStyle === '#123456') g.fillStyle = 'hsl(' + bg + ')'; // "0 0% 4%" のような書き方
      if (g.fillStyle !== '#123456') {
        g.fillRect(0, 0, 1, 1);
        var p = g.getImageData(0, 0, 1, 1).data;
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] < 128;
      }
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
  document.getElementById('title').textContent = data.title;

  var info = Mindra.parseMarkdown(data.markdown, data.title);
  var roots = info.roots;
  // 図の種類（front matter の view）。マインドマップ以外は、その図の描き方を使う。
  var kind = info.view !== 'mindmap' && Mindra.views[info.view] ? info.view : 'mindmap';
  var model = kind === 'mindmap' ? null : Mindra.views[kind].parse(data.markdown, data.title);
  var view = document.getElementById('view');
  var collapsed = new Set();
  var fit = true;
  var MIN_SCALE = 0.25; // Fit は全体を幅に収める（細かく読むときは 100% で横にスクロール）
  var noop = function () {};

  function draw() {
    var stage = kind !== 'mindmap' ? Mindra.views[kind].render(model, view, { zoom: 1 }) : Mindra.renderMindmap(roots, view, {
      collapsed: collapsed, selected: null, editing: null, commenting: null, menu: null,
      palette: [], chatOpen: false, zoom: 1,
      onSelect: noop, onEdit: noop, onRename: noop, onComment: noop, onSaveComment: noop,
      onCancelEdit: noop, onAddChild: noop, onMenu: noop, onColor: noop, onAddAI: noop,
      onToggle: function (id) {
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        draw();
      }
    });
    // 幅に合わせて縮める（Fit）。100% のときは、横にスクロールする。
    var width = parseFloat(stage.style.width);
    var height = parseFloat(stage.style.height);
    var room = view.clientWidth - 24;
    var scale = fit ? Math.max(MIN_SCALE, Math.min(1, room / width)) : 1;
    stage.firstChild.style.transform = 'scale(' + scale + ')';
    stage.style.width = width * scale + 'px';
    stage.style.height = height * scale + 'px';
  }

  function setFit(on) {
    fit = on;
    document.getElementById('fit').classList.toggle('is-on', on);
    document.getElementById('full').classList.toggle('is-on', !on);
    draw();
  }
  document.getElementById('fit').addEventListener('click', function () { setFit(true); });
  document.getElementById('full').addEventListener('click', function () { setFit(false); });
  addEventListener('resize', draw);
  draw();
})();
</script>
</body>
</html>
`;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('usage: export-html <in.md> [out.html]');
    process.exit(1);
  }
  const path = resolve(process.cwd(), input);
  if (extname(path).toLowerCase() !== '.md') {
    console.error('export-html: only .md files can be exported.');
    process.exit(1);
  }
  const title = basename(path, extname(path));
  const html = await buildHtml(await readFile(path, 'utf8'), title);

  if (output) {
    const out = resolve(process.cwd(), output);
    await writeFile(out, html, 'utf8');
    console.log(out);
    return;
  }
  // Orca のチャット用: 決まったフォルダに、毎回新しい名前で保存し、返信に貼る行を出す。
  const scratch = process.env.ORCA_CHAT_SCRATCH_DIR;
  if (!scratch) {
    console.error('export-html: give an output path (ORCA_CHAT_SCRATCH_DIR is not set).');
    process.exit(1);
  }
  const name = `mindmap-${randomBytes(3).toString('hex')}.html`;
  if (Buffer.byteLength(html) > 512 * 1024) {
    console.error('export-html: the page is larger than 512 KB, so Orca cannot show it.');
    process.exit(1);
  }
  await writeFile(join(scratch, name), html, 'utf8');
  console.log(`::orca-visual{file="${name}" title="${title.replace(/"/g, '')}"}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`export-html: ${err.message}`);
    process.exit(1);
  });
}

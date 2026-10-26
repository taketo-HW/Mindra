// ロジックツリー（view: logictree）。書き方は docs/図の種類.md。
// マインドマップと同じ読み方（見出しと箇条書きの階層）で、左から右へ、かぎ線でつなぐ。
(function (global) {
  'use strict';

  const PAD = 20;
  const GAP_X = 48; // 列どうしの間隔
  const GAP_Y = 12; // 同じ親の子どうしの間隔
  const GAP_TREE = 32; // 一番上の題目どうしの間隔

  // MD → { title, roots: [{ text, children }] }（マインドマップの木から、名前と子だけを残す）
  function parse(text, fileName) {
    const M = global.Mindra;
    const simplify = (node) => ({ text: node.text, children: node.children.map(simplify) });
    return { title: M.documentTitle(text, fileName), roots: M.parseMarkdown(text, fileName).roots.map(simplify) };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, ''); // 題名は、根の箱に出る
    const a = K.area(f.wrap);
    const entries = [];
    const walk = (node, depth, parent) => {
      const e = { node, depth, parent, children: [] };
      entries.push(e);
      if (parent) parent.children.push(e);
      node.children.forEach((child) => walk(child, depth + 1, e));
      return e;
    };
    const tops = model.roots.map((root) => walk(root, 0, null));
    for (const e of entries) {
      e.el = K.el('div', `vw-lt-node${e.depth === 0 ? ' is-root' : ''}`, e.node.text);
      a.box.appendChild(e.el);
      e.w = e.el.offsetWidth;
      e.h = e.el.offsetHeight;
    }
    // 列の位置（深さごと）。
    const colW = [];
    for (const e of entries) colW[e.depth] = Math.max(colW[e.depth] || 0, e.w);
    const colX = [PAD];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP_X;
    // 縦の位置: 子の塊の真ん中に、親を置く。
    const measure = (e) => {
      const heights = e.children.map(measure);
      e.total = heights.reduce((s, h) => s + h, 0) + GAP_Y * Math.max(0, heights.length - 1);
      e.block = Math.max(e.h, e.total);
      return e.block;
    };
    const place = (e, top) => {
      e.x = colX[e.depth];
      e.y = top + (e.block - e.h) / 2;
      let cursor = top + (e.block - e.total) / 2;
      for (const child of e.children) {
        place(child, cursor);
        cursor += child.block + GAP_Y;
      }
    };
    let cursor = PAD;
    for (const top of tops) {
      measure(top);
      place(top, cursor);
      cursor += top.block + GAP_TREE;
    }
    const width = Math.max(...entries.map((e) => e.x + e.w)) + PAD;
    const height = Math.max(...entries.map((e) => e.y + e.h)) + PAD;
    a.size(width, height);
    for (const e of entries) {
      e.el.style.left = `${e.x}px`;
      e.el.style.top = `${e.y}px`;
      if (!e.parent) continue;
      const p = e.parent;
      const x1 = p.x + p.w;
      const y1 = p.y + p.h / 2;
      const xm = x1 + GAP_X / 2;
      a.lines.appendChild(
        K.svg('path', { d: `M ${x1} ${y1} H ${xm} V ${e.y + e.h / 2} H ${e.x}`, class: 'vw-edge vw-lt-line' }),
      );
    }
    return f.done();
  }

  global.Mindra.views.logictree = { parse, render };
})(globalThis);

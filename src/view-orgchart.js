// 組織図（view: orgchart）。書き方は docs/図の種類.md。
// マインドマップと同じ読み方（見出しと箇条書きの階層）で、上から下へ、親の下に子を横に並べ、かぎ線でつなぐ。
(function (global) {
  'use strict';

  const PAD = 20;
  const GAP_X = 16; // 同じ親の子どうしの間隔
  const GAP_Y = 40; // 段どうしの間隔
  const GAP_TREE = 40; // 一番上の題目どうしの間隔

  // MD → { title, roots: [{ text, children }] }（マインドマップの木から、名前と子だけを残す）
  function parse(text, fileName) {
    const M = global.Mindra;
    const simplify = (node) => ({ text: node.text, children: node.children.map(simplify) });
    return { title: M.documentTitle(text, fileName), roots: M.parseMarkdown(text, fileName).roots.map(simplify) };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, ''); // 題名は、根の箱に出る
    if (!model.roots.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'Nothing to show yet. Write a # heading and - items under it.'));
      return f.done();
    }
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
      e.el = K.el('div', `vw-oc-node${e.depth === 0 ? ' is-root' : ''}`, e.node.text);
      a.box.appendChild(e.el);
      e.w = e.el.offsetWidth;
      e.h = e.el.offsetHeight;
    }
    // 段の位置（深さごと）。
    const rowH = [];
    for (const e of entries) rowH[e.depth] = Math.max(rowH[e.depth] || 0, e.h);
    const rowY = [PAD];
    for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + GAP_Y;
    // 横の位置: 子の塊の真ん中に、親を置く。
    const measure = (e) => {
      const widths = e.children.map(measure);
      e.total = widths.reduce((s, w) => s + w, 0) + GAP_X * Math.max(0, widths.length - 1);
      e.block = Math.max(e.w, e.total);
      return e.block;
    };
    const place = (e, left) => {
      e.x = left + (e.block - e.w) / 2;
      e.y = rowY[e.depth];
      let cursor = left + (e.block - e.total) / 2;
      for (const child of e.children) {
        place(child, cursor);
        cursor += child.block + GAP_X;
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
      const x1 = p.x + p.w / 2;
      const y1 = p.y + p.h;
      const ym = rowY[e.depth] - GAP_Y / 2;
      a.lines.appendChild(
        K.svg('path', { d: `M ${x1} ${y1} V ${ym} H ${e.x + e.w / 2} V ${e.y}`, class: 'vw-edge vw-oc-line' }),
      );
    }
    return f.done();
  }

  global.Mindra.views.orgchart = { parse, render };
})(globalThis);

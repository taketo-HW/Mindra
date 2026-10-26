// 関係図（view: network）。書き方は docs/図の種類.md。
// 「- A -- B: 名前」は向きの無いつながり、「- A -> B: 名前」は向きのあるつながり。
// 名前だけの行（「- 三郎」）は、つながりの無い点。点は円の周りに並べる（つながりの多いものほど先）。
(function (global) {
  'use strict';

  // つながりの記号。「-->」も向きありとして読む。
  const LINK = /\s*(-->|->|--)\s*/;

  // MD → { title, nodes: [{ name, degree }], edges: [{ from, to, directed, label }] }（from と to は番号）
  function parse(text, fileName) {
    const M = global.Mindra;
    const nodes = [];
    const ids = new Map();
    const idOf = (name) => {
      if (!ids.has(name)) {
        ids.set(name, nodes.length);
        nodes.push({ name, degree: 0 });
      }
      return ids.get(name);
    };
    const edges = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (!item) continue;
      const content = item[1];
      if (!LINK.test(content)) {
        const name = M.plainText(content);
        if (name) idOf(name);
        continue;
      }
      // 「A -- B -> C」のように続けて書いた行は、順につなぐ。名前は最後のつながりに付ける。
      const parts = content.split(/\s*(-->|->|--)\s*/);
      let label = '';
      const last = /^(.*?)\s*[:：]\s*(.*)$/.exec(parts[parts.length - 1]);
      if (last) {
        parts[parts.length - 1] = last[1];
        label = M.plainText(last[2]);
      }
      const names = [];
      const ops = [];
      parts.forEach((part, k) => (k % 2 ? ops.push(part) : names.push(M.plainText(part))));
      if (names.some((name) => !name)) continue;
      const nodeIds = names.map(idOf);
      for (let k = 0; k < ops.length; k++) {
        const from = nodeIds[k];
        const to = nodeIds[k + 1];
        edges.push({ from, to, directed: ops[k] !== '--', label: k === ops.length - 1 ? label : '' });
        nodes[from].degree++;
        if (to !== from) nodes[to].degree++;
      }
    }
    return { title: M.documentTitle(text, fileName), nodes, edges };
  }

  // 円に並べる順番: つながりの多い順。同じ数なら、書いた順。
  function order(model) {
    return model.nodes
      .map((node, i) => i)
      .sort((a, b) => model.nodes[b].degree - model.nodes[a].degree || a - b);
  }

  // 円の上の位置（中心 0,0、12 時の位置から時計回り）。node 番号ごとの { x, y } を返す。純粋な計算。
  function circle(model, radius) {
    const seq = order(model);
    const n = seq.length;
    const pos = new Array(n);
    seq.forEach((node, k) => {
      if (n === 1) {
        pos[node] = { x: 0, y: 0 };
        return;
      }
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / n;
      pos[node] = { x: round(radius * Math.cos(angle)), y: round(radius * Math.sin(angle)) };
    });
    return pos;
  }

  function round(v) {
    return Math.round(v * 100) / 100 || 0;
  }

  // 中心 (cx, cy)、半分の大きさ (hw, hh) の箱の辺と、中心から (dx, dy) の向きへの半直線が交わる点。
  function borderPoint(cx, cy, hw, hh, dx, dy) {
    if (!dx && !dy) return { x: cx, y: cy };
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  const PAD = 30;
  const GAP = 36; // 円の上で、隣の点との間
  const BORDER_GAP = 3; // 矢印の先と箱の間

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.nodes.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No nodes yet. Write lines like: - A -- B: friends or - A -> B'));
      return f.done();
    }
    const a = K.area(f.wrap);
    const hub = model.edges.length ? order(model)[0] : -1; // 一番つながりの多い点は、色を変える
    const divs = model.nodes.map((node, i) => {
      const div = K.el('div', `vw-nw-node${i === hub ? ' is-hub' : ''}`, node.name);
      a.box.appendChild(div);
      return div;
    });
    const w = divs.map((d) => d.offsetWidth);
    const h = divs.map((d) => d.offsetHeight);
    const n = model.nodes.length;
    const maxW = Math.max(...w);
    const maxH = Math.max(...h);

    // 半径: 隣どうしの箱が重ならない長さ（円周 ≥ 箱の幅の合計）。点が 2 つなら、横に並ぶ幅で決める。
    let radius = 0;
    if (n === 2) radius = Math.max(90, maxH + 60);
    else if (n > 2) {
      const around = w.reduce((sum, x, i) => sum + Math.max(x, h[i] * 2) + GAP, 0);
      radius = Math.max(110, around / (2 * Math.PI), (maxH + GAP) / (2 * Math.sin(Math.PI / n)));
    }
    const pos = circle(model, radius);
    const cx = PAD + radius + maxW / 2;
    const cy = PAD + radius + maxH / 2;
    a.size(Math.ceil(cx * 2), Math.ceil(cy * 2));
    const arrow = K.arrowMarker(a.lines, 'vw-nw-arrow');
    const center = model.nodes.map((node, i) => ({ x: cx + pos[i].x, y: cy + pos[i].y }));
    divs.forEach((div, i) => {
      div.style.left = `${center[i].x - w[i] / 2}px`;
      div.style.top = `${center[i].y - h[i] / 2}px`;
    });

    // 同じ 2 点を結ぶ線が複数あるときは、左右にふくらませて分ける。
    const pairCount = new Map();
    const pairKey = (e) => (e.from < e.to ? `${e.from}:${e.to}` : `${e.to}:${e.from}`);
    for (const e of model.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) || 0) + 1);
    const pairSeen = new Map();

    const labels = [];
    model.edges.forEach((e) => {
      const p = center[e.from];
      const q = center[e.to];
      if (e.from === e.to) {
        // 自分へのつながりは、箱の上に小さな輪で描く。
        const top = p.y - h[e.from] / 2;
        const d = `M ${p.x - 10} ${top} C ${p.x - 30} ${top - 40}, ${p.x + 30} ${top - 40}, ${p.x + 10} ${top - BORDER_GAP}`;
        a.lines.appendChild(K.svg('path', Object.assign({ d, class: 'vw-edge' }, e.directed ? { 'marker-end': arrow } : {})));
        if (e.label) labels.push({ text: e.label, x: p.x, y: top - 34 });
        return;
      }
      const key = pairKey(e);
      const count = pairCount.get(key);
      const k = pairSeen.get(key) || 0;
      pairSeen.set(key, k + 1);
      // ふくらみの向きは、番号の小さい点から見て決める（向きが逆の線でも、同じ側に重ならない）。
      const lo = center[Math.min(e.from, e.to)];
      const hi = center[Math.max(e.from, e.to)];
      const len = Math.hypot(hi.x - lo.x, hi.y - lo.y) || 1;
      const nx = -(hi.y - lo.y) / len;
      const ny = (hi.x - lo.x) / len;
      const offset = (k - (count - 1) / 2) * 44;
      const c = { x: (p.x + q.x) / 2 + nx * offset, y: (p.y + q.y) / 2 + ny * offset };
      const end = (i, toward, gap) =>
        borderPoint(center[i].x, center[i].y, w[i] / 2 + gap, h[i] / 2 + gap, toward.x - center[i].x, toward.y - center[i].y);
      const s = end(e.from, c, 0);
      const t = end(e.to, c, e.directed ? BORDER_GAP : 0);
      const d = offset
        ? `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${t.x} ${t.y}`
        : `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
      a.lines.appendChild(K.svg('path', Object.assign({ d, class: 'vw-edge vw-nw-edge' }, e.directed ? { 'marker-end': arrow } : {})));
      if (e.label) {
        const mx = offset ? 0.25 * s.x + 0.5 * c.x + 0.25 * t.x : (s.x + t.x) / 2;
        const my = offset ? 0.25 * s.y + 0.5 * c.y + 0.25 * t.y : (s.y + t.y) / 2;
        labels.push({ text: e.label, x: mx, y: my });
      }
    });
    // 名前は線の上に描く（線の真ん中。文字の縁取りで線を隠す）。
    for (const l of labels) {
      const label = K.svg('text', { x: l.x, y: l.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'vw-label-text' });
      label.textContent = l.text;
      a.lines.appendChild(label);
    }
    return f.done();
  }

  global.Mindra.views.network = { parse, render, order, circle, borderPoint };
})(globalThis);

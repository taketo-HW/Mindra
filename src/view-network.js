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

  // 角の丸い箱（カプセル形）の縁と、中心から (dx, dy) の向きへの半直線が交わる点。gap は外側への余白。
  function capsulePoint(cx, cy, hw, hh, dx, dy, gap) {
    const len = Math.hypot(dx, dy);
    if (!len) return { x: cx, y: cy };
    const ux = dx / len;
    const uy = dy / len;
    const r = hh + gap;
    const flat = Math.max(0, hw - hh); // 両端の半円の中心の、真ん中からの距離
    let t = Infinity;
    if (uy) {
      const tf = r / Math.abs(uy);
      if (Math.abs(ux * tf) <= flat) t = tf;
    }
    if (t === Infinity) {
      // 端の半円: |u t - (±flat, 0)| = r を解く
      const ccx = ux >= 0 ? flat : -flat;
      const b = ux * ccx;
      t = b + Math.sqrt(Math.max(0, b * b - ccx * ccx + r * r));
    }
    return { x: cx + ux * t, y: cy + uy * t };
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
    const edges = []; // 線ごとの通り道の点（名前の置き場所を選ぶのに使う）
    model.edges.forEach((e) => {
      const p = center[e.from];
      const q = center[e.to];
      if (e.from === e.to) {
        // 自分へのつながりは、箱の上に小さな輪で描く。
        const top = p.y - h[e.from] / 2;
        const d = `M ${p.x - 10} ${top} C ${p.x - 30} ${top - 40}, ${p.x + 30} ${top - 40}, ${p.x + 10} ${top - BORDER_GAP}`;
        a.lines.appendChild(K.svg('path', Object.assign({ d, class: 'vw-edge' }, e.directed ? { 'marker-end': arrow } : {})));
        if (e.label) {
          const tw = K.textWidth(e.label, a.box) + 6;
          const x = p.x;
          const y = top - 34;
          labels.push({ text: e.label, x, y, fixed: true, r: { x0: x - tw / 2, x1: x + tw / 2, y0: y - 8, y1: y + 8 } });
        }
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
      // 中心どうし（ふくらませた線は、ふくらみの点）に向かう線が、箱の縁と交わる点で止める。
      const end = (i, toward, gap) =>
        capsulePoint(center[i].x, center[i].y, w[i] / 2, h[i] / 2, toward.x - center[i].x, toward.y - center[i].y, gap);
      const s = end(e.from, c, 0);
      const t = end(e.to, c, e.directed ? BORDER_GAP : 0);
      const d = offset
        ? `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${t.x} ${t.y}`
        : `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
      a.lines.appendChild(K.svg('path', Object.assign({ d, class: 'vw-edge vw-nw-edge' }, e.directed ? { 'marker-end': arrow } : {})));
      if (e.label) {
        const at = (u) => {
          const m = 1 - u;
          return offset
            ? { x: m * m * s.x + 2 * m * u * c.x + u * u * t.x, y: m * m * s.y + 2 * m * u * c.y + u * u * t.y }
            : { x: s.x + (t.x - s.x) * u, y: s.y + (t.y - s.y) * u };
        };
        const pts = [];
        for (let u = 0; u <= 1.0001; u += 0.05) pts.push(at(u));
        labels.push({ text: e.label, at, edge: edges.length });
        edges.push(pts);
        return;
      }
      edges.push((() => {
        const pts = [];
        for (let u = 0; u <= 1.0001; u += 0.05) pts.push(offset ? { x: (1 - u) * (1 - u) * s.x + 2 * (1 - u) * u * c.x + u * u * t.x, y: (1 - u) * (1 - u) * s.y + 2 * (1 - u) * u * c.y + u * u * t.y } : { x: s.x + (t.x - s.x) * u, y: s.y + (t.y - s.y) * u });
        return pts;
      })());
    });
    // 名前は、自分の線の上のいくつかの候補から、他の線・名前・点と重ならない場所を選び、線の横にずらして置く。
    const placed = [];
    const nodeRects = center.map((p, i) => ({ x0: p.x - w[i] / 2, x1: p.x + w[i] / 2, y0: p.y - h[i] / 2, y1: p.y + h[i] / 2 }));
    const hit = (r, x, y, pad) => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;
    for (const l of labels) {
      if (l.fixed) {
        placed.push(l);
        continue;
      }
      const tw = K.textWidth(l.text, a.box) + 6;
      const th = 16;
      let best = null;
      for (const u of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        const p0 = l.at(u);
        const p1 = l.at(Math.min(1, u + 0.02));
        const q1 = l.at(Math.max(0, u - 0.02));
        const tx = p1.x - q1.x;
        const ty = p1.y - q1.y;
        const tl = Math.hypot(tx, ty) || 1;
        for (const side of [1, -1]) {
          const nx = (-ty / tl) * side;
          const ny = (tx / tl) * side;
          const d = (Math.abs(nx) * tw) / 2 + (Math.abs(ny) * th) / 2 + 2;
          const x = p0.x + nx * d;
          const y = p0.y + ny * d;
          const r = { x0: x - tw / 2, x1: x + tw / 2, y0: y - th / 2, y1: y + th / 2 };
          let cost = Math.abs(u - 0.5) * 40 + (side < 0 ? 1 : 0);
          edges.forEach((pts, ei) => {
            // 自分の線は、横にずらしてあるので数えない
            const w1 = ei === l.edge ? 0.2 : 1;
            for (const pt of pts) if (hit(r, pt.x, pt.y, 2)) cost += 25 * w1;
          });
          for (const o of placed) if (r.x0 < o.r.x1 && r.x1 > o.r.x0 && r.y0 < o.r.y1 && r.y1 > o.r.y0) cost += 500;
          for (const nr of nodeRects) if (r.x0 < nr.x1 + 3 && r.x1 > nr.x0 - 3 && r.y0 < nr.y1 + 3 && r.y1 > nr.y0 - 3) cost += 500;
          if (!best || cost < best.cost) best = { cost, x, y, r };
        }
      }
      l.x = best.x;
      l.y = best.y;
      l.r = best.r;
      placed.push(l);
    }
    for (const l of labels) {
      const label = K.svg('text', { x: l.x, y: l.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'vw-label-text' });
      label.textContent = l.text;
      a.lines.appendChild(label);
    }
    return f.done();
  }

  global.Mindra.views.network = { parse, render, order, circle, borderPoint, capsulePoint };
})(globalThis);

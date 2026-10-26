// フローチャート（view: flowchart）。書き方は docs/図の種類.md。
// 「- A -> B」「- A -> B: 条件」「- A -> B -> C」の行から、箱と矢印を作る。
// 名前の末尾が「？」または「?」の箱は、判断（ひし形）として描く。
(function (global) {
  'use strict';

  // MD → { title, nodes: [{ name, decision }], edges: [{ from, to, label }] }（from と to は番号）
  function parse(text, fileName) {
    const M = global.Mindra;
    const nodes = [];
    const ids = new Map();
    const idOf = (name) => {
      if (!ids.has(name)) {
        ids.set(name, nodes.length);
        nodes.push({ name, decision: /[?？]$/.test(name) });
      }
      return ids.get(name);
    };
    const edges = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (!item) continue;
      const content = item[1];
      if (!/-{1,2}>/.test(content)) {
        const name = M.plainText(content);
        if (name) idOf(name);
        continue;
      }
      const parts = content.split(/\s*-{1,2}>\s*/);
      // 条件（「: はい」）は、最後の矢印に付ける。
      let label = '';
      const last = /^(.*?)\s*[:：]\s*(.*)$/.exec(parts[parts.length - 1]);
      if (last) {
        parts[parts.length - 1] = last[1];
        label = M.plainText(last[2]);
      }
      const names = parts.map(M.plainText);
      if (names.some((name) => !name)) continue;
      for (let i = 0; i < names.length - 1; i++) {
        edges.push({ from: idOf(names[i]), to: idOf(names[i + 1]), label: i === names.length - 2 ? label : '' });
      }
    }
    return { title: M.documentTitle(text, fileName), nodes, edges };
  }

  // 段（左から何列目か）を決める。戻る矢印（循環）は、段の計算に使わない。
  function ranks(model) {
    const n = model.nodes.length;
    const out = model.nodes.map(() => []);
    model.edges.forEach((e, i) => out[e.from].push(i));
    const back = new Set();
    const state = new Array(n).fill(0); // 0: 未訪問, 1: 訪問中, 2: 済み
    for (let s = 0; s < n; s++) {
      if (state[s]) continue;
      const stack = [[s, 0]];
      state[s] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const u = top[0];
        if (top[1] < out[u].length) {
          const edgeIndex = out[u][top[1]++];
          const v = model.edges[edgeIndex].to;
          if (state[v] === 1) back.add(edgeIndex);
          else if (state[v] === 0) {
            state[v] = 1;
            stack.push([v, 0]);
          }
        } else {
          state[u] = 2;
          stack.pop();
        }
      }
    }
    const indegree = new Array(n).fill(0);
    model.edges.forEach((e, i) => {
      if (!back.has(i)) indegree[e.to]++;
    });
    const rank = new Array(n).fill(0);
    const queue = [];
    for (let i = 0; i < n; i++) if (!indegree[i]) queue.push(i);
    while (queue.length) {
      const u = queue.shift();
      for (const edgeIndex of out[u]) {
        if (back.has(edgeIndex)) continue;
        const v = model.edges[edgeIndex].to;
        rank[v] = Math.max(rank[v], rank[u] + 1);
        if (--indegree[v] === 0) queue.push(v);
      }
    }
    return { rank, back };
  }

  const PAD = 20;
  const GAP_X = 70;
  const GAP_Y = 28;

  // 並べ方を決める（箱の大きさ bw / bh を受け取り、位置を返す）。純粋な計算なので、テストできる。
  // 2 列以上をまたぐ矢印は、間の列に「通り道」の点を置き、箱と重ならないようにする。
  function layout(model, bw, bh) {
    const { rank, back } = ranks(model);
    const n = model.nodes.length;
    const columns = [];
    const nodeItem = [];
    for (let i = 0; i < n; i++) {
      const item = { node: i, w: bw[i], h: bh[i], up: [] };
      nodeItem[i] = item;
      (columns[rank[i]] = columns[rank[i]] || []).push(item);
    }
    for (let r = 0; r < columns.length; r++) columns[r] = columns[r] || [];
    const via = new Map(); // 矢印の番号 → 通り道の点
    model.edges.forEach((e, i) => {
      if (back.has(i) || e.from === e.to) return;
      const target = nodeItem[e.to];
      let prev = nodeItem[e.from];
      const points = [];
      for (let r = rank[e.from] + 1; r < rank[e.to]; r++) {
        const point = { edge: i, w: 0, h: 14, up: [prev] };
        columns[r].push(point);
        points.push(point);
        prev = point;
      }
      target.up.push(prev);
      via.set(i, points);
    });

    // 列の中の順番: 前の列でつながっている相手の、平均の位置に近づける（線の交差を減らす）。
    columns[0].forEach((item, k) => (item.order = k));
    for (let r = 1; r < columns.length; r++) {
      columns[r] = columns[r]
        .map((item, k) => {
          const ups = item.up.filter((u) => u.order !== undefined);
          return { item, key: ups.length ? ups.reduce((sum, u) => sum + u.order, 0) / ups.length : k };
        })
        .sort((x, y) => x.key - y.key)
        .map((x) => x.item);
      columns[r].forEach((item, k) => (item.order = k));
    }

    // 位置。列の幅は、その列で一番広い箱。列の中は、上下中央にそろえる。
    const colW = columns.map((col) => Math.max(0, ...col.map((item) => item.w)));
    const colH = columns.map((col) => col.reduce((sum, item) => sum + item.h, 0) + GAP_Y * Math.max(0, col.length - 1));
    const maxH = Math.max(...colH);
    let x = PAD;
    columns.forEach((col, r) => {
      let y = PAD + (maxH - colH[r]) / 2;
      for (const item of col) {
        item.x = x + (colW[r] - item.w) / 2;
        item.y = y;
        y += item.h + GAP_Y;
      }
      x += colW[r] + GAP_X;
    });
    return {
      rank,
      back,
      via,
      boxes: nodeItem.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h })),
      right: x - GAP_X,
      bottom: PAD + maxH,
    };
  }

  // 点をなめらかにつなぐ（横向きに出て、横向きに入る）。
  function smoothPath(points) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1];
      const b = points[k];
      const mid = (a.x + b.x) / 2;
      d += ` C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
    }
    return d;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.nodes.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No steps yet. Write lines like: - A -> B'));
      return f.done();
    }
    const a = K.area(f.wrap);

    // 箱を置いて、大きさを測る。判断の箱は、ひし形の分だけ大きく取る。
    const labels = model.nodes.map((node) => {
      const div = K.el('div', `vw-fc-node${node.decision ? ' is-decision' : ''}`, node.name);
      a.box.appendChild(div);
      return div;
    });
    const tw = labels.map((d) => d.offsetWidth);
    const th = labels.map((d) => d.offsetHeight);
    const bw = model.nodes.map((node, i) => (node.decision ? tw[i] * 2 + 20 : tw[i]));
    const bh = model.nodes.map((node, i) => (node.decision ? th[i] * 2 + 12 : th[i]));

    const L = layout(model, bw, bh);
    const B = L.boxes;
    const loopRoom = L.back.size ? 50 : 0;
    const width = L.right + PAD + (model.edges.some((e) => e.from === e.to) ? 50 : 0);
    const height = L.bottom + loopRoom + PAD;
    a.size(width, height);
    const arrow = K.arrowMarker(a.lines, 'vw-fc-arrow');

    // 文字の箱の位置（判断の箱は、ひし形の真ん中に置く）。
    labels.forEach((div, i) => {
      div.style.left = `${B[i].x + (B[i].w - tw[i]) / 2}px`;
      div.style.top = `${B[i].y + (B[i].h - th[i]) / 2}px`;
    });

    const addLabel = (text, lx, ly) => {
      if (!text) return;
      const label = K.svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'vw-label-text' });
      label.textContent = text;
      a.lines.appendChild(label);
    };

    // 矢印。前へ進む矢印は、右の辺から左の辺へ（通り道の点を通る）。戻る矢印は、下を回る。
    model.edges.forEach((e, i) => {
      const u = B[e.from];
      const v = B[e.to];
      if (e.from === e.to) {
        const sx = u.x + u.w;
        const sy = u.y + u.h / 2;
        a.lines.appendChild(
          K.svg('path', {
            d: `M ${sx} ${sy - 6} C ${sx + 44} ${sy - 36}, ${sx + 44} ${sy + 36}, ${sx} ${sy + 6}`,
            class: 'vw-edge',
            'marker-end': arrow,
          }),
        );
        addLabel(e.label, sx + 40, sy - 26);
        return;
      }
      if (L.back.has(i)) {
        const x1 = u.x + u.w / 2;
        const y1 = u.y + u.h;
        const x2 = v.x + v.w / 2;
        const y2 = v.y + v.h;
        const yc = L.bottom + loopRoom - 10;
        a.lines.appendChild(
          K.svg('path', { d: `M ${x1} ${y1} C ${x1} ${yc}, ${x2} ${yc}, ${x2} ${y2}`, class: 'vw-edge is-back', 'marker-end': arrow }),
        );
        addLabel(e.label, (x1 + x2) / 2, yc - 4);
        return;
      }
      const points = [{ x: u.x + u.w, y: u.y + u.h / 2 }];
      for (const p of L.via.get(i) || []) points.push({ x: p.x, y: p.y + p.h / 2 });
      points.push({ x: v.x, y: v.y + v.h / 2 });
      a.lines.appendChild(K.svg('path', { d: smoothPath(points), class: 'vw-edge', 'marker-end': arrow }));
      addLabel(e.label, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2 - 6);
    });

    // 判断のひし形（矢印の上に描く）。
    model.nodes.forEach((node, i) => {
      if (!node.decision) return;
      const b = B[i];
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      a.lines.appendChild(
        K.svg('polygon', {
          points: `${b.x},${cy} ${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h}`,
          class: 'vw-fc-diamond',
        }),
      );
    });
    return f.done();
  }

  global.Mindra.views.flowchart = { parse, render, ranks, layout };
})(globalThis);

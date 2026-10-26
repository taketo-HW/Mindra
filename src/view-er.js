// ER 図（view: er）。書き方は docs/図の種類.md。
// 区切り（##）が表、「- 列: 型」が列（型の後ろの PK / FK は印）。「->」を含む行は表どうしの関係（場所はどこでもよい）。
(function (global) {
  'use strict';

  // 列の行「id: int PK」→ { name, type, pk, fk }
  function parseColumn(content, plainText) {
    const m = /^(.*?)\s*(?::\s|：|:$)\s*(.*)$/.exec(content);
    const name = plainText(m ? m[1] : content);
    if (!name) return null;
    const words = m ? plainText(m[2]).split(/\s+/).filter(Boolean) : [];
    let pk = false;
    let fk = false;
    // 型の後ろの印（PK / FK）を、後ろから取り出す。
    while (words.length && /^(PK|FK)$/i.test(words[words.length - 1])) {
      if (/^PK$/i.test(words.pop())) pk = true;
      else fk = true;
    }
    return { name, type: words.join(' '), pk, fk };
  }

  // MD → { title, tables: [{ name, columns: [{ name, type, pk, fk }] }], relations: [{ from, to, label }] }
  // from と to は表の番号。関係にだけ出てくる表は、列なしの表として加える。
  function parse(text, fileName) {
    const M = global.Mindra;
    const tables = [];
    const ids = new Map();
    const idOf = (name) => {
      if (!ids.has(name)) {
        ids.set(name, tables.length);
        tables.push({ name, columns: [] });
      }
      return ids.get(name);
    };
    const relations = [];
    let current = null;
    for (const { text: line } of M.documentLines(text).lines) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        if (heading[1].length >= 2) {
          const name = M.plainText(heading[2]);
          current = name ? idOf(name) : null;
        }
        continue;
      }
      // 関係は、箇条書きの行（- A -> B）だけ。段落の行は無視する。
      if (/^\s*-\s+.*-{1,2}>/.test(line)) {
        const content = line.replace(/^\s*-\s+/, '');
        const parts = content.split(/\s*-{1,2}>\s*/);
        let label = '';
        const last = /^(.*?)\s*[:：]\s*(.*)$/.exec(parts[parts.length - 1]);
        if (last) {
          parts[parts.length - 1] = last[1];
          label = M.plainText(last[2]);
        }
        const names = parts.map(M.plainText);
        if (names.some((name) => !name)) continue;
        for (let i = 0; i < names.length - 1; i++) {
          relations.push({ from: idOf(names[i]), to: idOf(names[i + 1]), label: i === names.length - 2 ? label : '' });
        }
        continue;
      }
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (!item || current === null) continue;
      const column = parseColumn(item[1], M.plainText);
      if (column) tables[current].columns.push(column);
    }
    return { title: M.documentTitle(text, fileName), tables, relations };
  }

  const PAD = 24;
  const PER_ROW = 3;
  const GAP_X = 110;
  const GAP_Y = 80;

  // 箱の中心から相手の方向へ伸ばした線が、箱の縁と交わる点。
  function edgePoint(b, tx, ty) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.tables.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No tables yet. Write "## Table" headings with "- column: type" items.'));
      return f.done();
    }
    const a = K.area(f.wrap);

    // 表の箱を作って、大きさを測る。
    const boxes = model.tables.map((table) => {
      const div = K.el('div', 'vw-er-table');
      div.appendChild(K.el('div', 'vw-er-head', table.name));
      const body = K.el('div', 'vw-er-cols');
      if (!table.columns.length) body.appendChild(K.el('div', 'vw-er-none', '(no columns)'));
      for (const col of table.columns) {
        const row = K.el('div', 'vw-er-row');
        const keys = K.el('span', 'vw-er-keys');
        if (col.pk) keys.appendChild(K.el('span', 'vw-er-badge is-pk', 'PK'));
        if (col.fk) keys.appendChild(K.el('span', 'vw-er-badge is-fk', 'FK'));
        row.appendChild(keys);
        row.appendChild(K.el('span', 'vw-er-name', col.name));
        row.appendChild(K.el('span', 'vw-er-type', col.type));
        body.appendChild(row);
      }
      div.appendChild(body);
      a.box.appendChild(div);
      return div;
    });
    const bw = boxes.map((d) => d.offsetWidth);
    const bh = boxes.map((d) => d.offsetHeight);

    // 格子に並べる（1 行に 3 つまで）。列の幅・行の高さは、その中で一番大きい箱。
    const n = boxes.length;
    const cols = Math.min(PER_ROW, n);
    const rows = Math.ceil(n / cols);
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    for (let i = 0; i < n; i++) {
      colW[i % cols] = Math.max(colW[i % cols], bw[i]);
      rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], bh[i]);
    }
    const colX = [];
    let x = PAD;
    for (let c = 0; c < cols; c++) {
      colX.push(x);
      x += colW[c] + GAP_X;
    }
    const rowY = [];
    let y = PAD + GAP_Y / 2; // 上は、同じ行の離れた表を結ぶ線の通り道
    for (let r = 0; r < rows; r++) {
      rowY.push(y);
      y += rowH[r] + GAP_Y;
    }
    const B = boxes.map((div, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const b = { x: colX[c] + (colW[c] - bw[i]) / 2, y: rowY[r], w: bw[i], h: bh[i], c, r };
      div.style.left = `${b.x}px`;
      div.style.top = `${b.y}px`;
      return b;
    });
    const width = x - GAP_X + PAD + GAP_X / 2; // 右は、同じ列の離れた表を結ぶ線の通り道
    const height = y - GAP_Y + PAD;
    a.size(width, height);
    const arrow = K.arrowMarker(a.lines, 'vw-er-arrow');

    const addLabel = (text, lx, ly) => {
      if (!text) return;
      const label = K.svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'vw-label-text vw-er-label' });
      label.textContent = text;
      a.lines.appendChild(label);
    };
    const path = (d) => a.lines.appendChild(K.svg('path', { d, class: 'vw-edge vw-er-edge', 'marker-end': arrow }));

    // 同じ 2 つの表を結ぶ線が複数あるときは、少しずらす。
    const seen = new Map();
    model.relations.forEach((rel) => {
      const u = B[rel.from];
      const v = B[rel.to];
      const key = [Math.min(rel.from, rel.to), Math.max(rel.from, rel.to)].join('-');
      const k = seen.get(key) || 0;
      seen.set(key, k + 1);
      const shift = k * 14;
      if (rel.from === rel.to) {
        // 自分への関係: 右上の角を回る。
        const sx = u.x + u.w;
        const sy = u.y + 14 + shift;
        const tx = u.x + u.w - 20 - shift;
        const ty = u.y;
        path(`M ${sx} ${sy} C ${sx + 40} ${sy}, ${tx} ${ty - 40}, ${tx} ${ty}`);
        addLabel(rel.label, sx + 22, ty - 18);
        return;
      }
      if (u.r === v.r && Math.abs(u.c - v.c) > 1) {
        // 同じ行で間に表があるとき: 上を回る。
        const x1 = u.x + u.w / 2 + shift;
        const x2 = v.x + v.w / 2 + shift;
        const yc = u.y - GAP_Y / 2 + 6 - shift;
        path(`M ${x1} ${u.y} L ${x1} ${yc} L ${x2} ${yc} L ${x2} ${v.y}`);
        addLabel(rel.label, (x1 + x2) / 2, yc - 5);
        return;
      }
      if (u.c === v.c && Math.abs(u.r - v.r) > 1) {
        // 同じ列で間に表があるとき: 右を回る。
        const right = colX[u.c] + colW[u.c] + GAP_X / 2 + shift;
        const y1 = u.y + u.h / 2 + shift;
        const y2 = v.y + v.h / 2 + shift;
        path(`M ${u.x + u.w} ${y1} L ${right} ${y1} L ${right} ${y2} L ${v.x + v.w} ${y2}`);
        addLabel(rel.label, right, (y1 + y2) / 2);
        return;
      }
      // それ以外: 箱の縁から縁へ、まっすぐ。
      const ucx = u.x + u.w / 2;
      const ucy = u.y + u.h / 2 + shift;
      const vcx = v.x + v.w / 2;
      const vcy = v.y + v.h / 2 + shift;
      const p = edgePoint({ ...u, y: u.y + shift }, vcx, vcy);
      const q = edgePoint({ ...v, y: v.y + shift }, ucx, ucy);
      path(`M ${p.x} ${p.y} L ${q.x} ${q.y}`);
      addLabel(rel.label, (p.x + q.x) / 2, (p.y + q.y) / 2 - 6);
    });
    return f.done();
  }

  global.Mindra.views.er = { parse, render, parseColumn };
})(globalThis);

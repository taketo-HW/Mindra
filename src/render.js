// 木 → マインドマップ（DOM と SVG の線）。図の種類ごとに、この部分を差し替える。
// 木の形は parse.js を参照。id は "0.1.2" 形式のパス。
// 配置: 根を左端に置き、枝は右へ伸びる。ノードは実際の大きさを測ってから並べる。
// state: { collapsed, selected, editing, commenting, zoom, onSelect, onToggle, onEdit, onRename,
//          onComment, onSaveComment, onCancelEdit, onAddChild }
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PAD = 24; // 図の外側の余白
  const GAP_X = 56; // 列どうしの間隔
  const GAP_Y = 14; // 同じ親の子どうしの間隔
  const GAP_TOPIC = 48; // 一番上の題目どうしの間隔

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 名前の編集欄。Enter で確定、Esc で取り消し、フォーカスが外れたら確定する。
  function renderEditor(node, id, state) {
    const input = el('input', 'mm-input');
    input.type = 'text';
    input.value = node.text;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) state.onRename(id, input.value);
      else state.onCancelEdit();
    };
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return; // 変換中の Enter は確定ではない
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    // ページに入ってからフォーカスする。
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  // コメントの編集欄。Ctrl+Enter（Mac は Cmd+Enter）か、フォーカスが外れたら保存、Esc で取り消す。
  function renderCommentEditor(entry, state) {
    const area = el('textarea', 'mm-comment-input');
    area.rows = 3;
    area.value = (entry.node.comment || []).join('\n');
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) state.onSaveComment(entry.id, area.value);
      else state.onCancelEdit();
    };
    area.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    area.addEventListener('blur', () => finish(true));
    queueMicrotask(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
    return area;
  }

  // ＊のメニュー。コメントを書く、項目の色を選ぶ。
  function renderMenu(entry, state) {
    const menu = el('div', 'mm-menu');
    const note = el('button', 'mm-menu-comment', entry.node.comment ? 'Edit comment' : 'Comment');
    note.type = 'button';
    note.addEventListener('click', () => state.onComment(entry.id));
    menu.appendChild(note);
    const swatches = el('div', 'mm-menu-colors');
    const none = el('button', 'swatch swatch-none', '×');
    none.type = 'button';
    none.title = 'No color';
    none.addEventListener('click', () => state.onColor(entry.id, null));
    swatches.appendChild(none);
    for (const hex of state.palette) {
      const button = el('button', 'swatch');
      button.type = 'button';
      button.style.background = hex;
      button.addEventListener('click', () => state.onColor(entry.id, hex));
      swatches.appendChild(button);
    }
    menu.appendChild(swatches);
    return menu;
  }

  // 1 つのノードの DOM（位置は後で決める）。
  function renderNodeBox(entry, state) {
    const box = el('div', 'mm-node');
    // 項目の本体（名前と角のボタン）。線はここに結ぶ。コメントは、この下に出す。
    const head = el('div', 'mm-head');
    entry.head = head;
    box.appendChild(head);
    if (state.editing === entry.id) {
      head.appendChild(renderEditor(entry.node, entry.id, state));
    } else {
      const label = el('button', `mm-label mm-kind-${entry.node.kind}`, entry.node.text);
      label.type = 'button';
      // 項目の色（パステル）。背景が明るいので、文字は暗い色にする（暗いテーマでも読めるように）。
      if (entry.node.color) {
        label.style.background = entry.node.color;
        label.style.color = '#222';
      }
      if (entry.id === state.selected) label.classList.add('is-selected');
      label.addEventListener('click', () => state.onSelect(entry.id));
      label.addEventListener('dblclick', () => state.onEdit(entry.id));
      head.appendChild(label);
    }
    // コメント: 表示のときは本文を、編集のときは編集欄を、ノードの下に出す。
    if (state.commenting === entry.id) {
      box.appendChild(renderCommentEditor(entry, state));
    } else if (entry.node.comment && entry.node.comment.length) {
      box.appendChild(el('div', 'mm-comment', entry.node.comment.join('\n')));
    }
    // 右側に縦に並ぶ道具: 上から「＋」（子を追加）、「−」（折りたたみ）、「＊」（コメントと色）。
    const editing = state.editing === entry.id || state.commenting === entry.id;
    const tools = el('div', 'mm-tools');
    if (!editing) {
      const add = el('button', 'mm-add', '+');
      add.type = 'button';
      add.title = 'Add child';
      add.addEventListener('click', () => state.onAddChild(entry.id));
      tools.appendChild(add);
    }
    if (entry.hasChildren) {
      const collapsed = state.collapsed.has(entry.id);
      const toggle = el('button', 'mm-toggle', collapsed ? `+${entry.node.children.length}` : '−');
      toggle.type = 'button';
      toggle.title = collapsed ? 'Expand' : 'Collapse';
      toggle.addEventListener('click', () => state.onToggle(entry.id));
      tools.appendChild(toggle);
    }
    if (!editing) {
      // ＊の横に、メニューを出す（ノードの下には出さない）。
      const starWrap = el('div', 'mm-star-wrap');
      const star = el('button', 'mm-star', '＊');
      star.type = 'button';
      star.title = 'Comment and color';
      star.addEventListener('click', () => state.onMenu(entry.id));
      starWrap.appendChild(star);
      if (state.menu === entry.id) starWrap.appendChild(renderMenu(entry, state));
      tools.appendChild(starWrap);
    }
    head.appendChild(tools);
    return box;
  }

  // 表示する要素を、親子の関係つきで平らな並びにする（折りたたんだ先は含めない）。
  function flatten(node, id, depth, parent, state, out) {
    const entry = {
      id,
      node,
      depth,
      parent,
      children: [],
      hasChildren: node.children.length > 0,
    };
    out.push(entry);
    if (parent) parent.children.push(entry);
    if (entry.hasChildren && !state.collapsed.has(id)) {
      node.children.forEach((child, i) => flatten(child, `${id}.${i}`, depth + 1, entry, state, out));
    }
    return entry;
  }

  // 子の塊の高さ（block）と、子の並びの高さ（total）を求める。
  function measure(entry) {
    const heights = entry.children.map(measure);
    entry.total = heights.reduce((sum, h) => sum + h, 0) + GAP_Y * Math.max(0, heights.length - 1);
    entry.block = Math.max(entry.h, entry.total);
    return entry.block;
  }

  // 親の塊の中で、ノードと子を縦に並べる。ノードは塊の中央、子は塊の中央に寄せる。
  function place(entry, top, colX) {
    entry.x = colX[entry.depth];
    entry.y = top + (entry.block - entry.h) / 2;
    let cursor = top + (entry.block - entry.total) / 2;
    for (const child of entry.children) {
      place(child, cursor, colX);
      cursor += child.block + GAP_Y;
    }
  }

  function drawLines(entries, width, height) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'mm-lines');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    for (const entry of entries) {
      if (!entry.parent) continue;
      // 線は、項目の本体（名前の箱）の右端と中央から出る。コメントの下からは出ない。
      const x1 = entry.parent.x + entry.parent.lw;
      const y1 = entry.parent.y + entry.parent.lh / 2;
      const x2 = entry.x;
      const y2 = entry.y + entry.lh / 2;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', `mm-line mm-line-${Math.min(entry.depth, 3)}`);
      svg.appendChild(path);
    }
    return svg;
  }

  // roots は一番上の題目の一覧。題目どうしは、縦に並べる（線はつながらなくてもよい）。
  function renderMindmap(roots, container, state) {
    const list = Array.isArray(roots) ? roots : [roots];
    const entries = [];
    const tops = list.map((tree, i) => flatten(tree, String(i), 0, null, state, entries));

    // 1. 置いて測る（測るには DOM に入っている必要がある）。
    const stage = el('div', 'mm'); // 拡大後の大きさを持つ（スクロールのため）
    const canvas = el('div', 'mm-canvas'); // 拡大前の大きさで並べ、scale で拡大する
    stage.appendChild(canvas);
    for (const entry of entries) {
      entry.el = renderNodeBox(entry, state);
      canvas.appendChild(entry.el);
    }
    container.replaceChildren(stage);
    for (const entry of entries) {
      entry.w = entry.el.offsetWidth;
      entry.h = entry.el.offsetHeight;
      entry.lw = entry.head.offsetWidth;
      entry.lh = entry.head.offsetHeight;
    }

    // 2. 列の位置（深さごとに、その列で一番広いノードの幅を使う）。
    const colW = [];
    for (const entry of entries) colW[entry.depth] = Math.max(colW[entry.depth] || 0, entry.w);
    const colX = [PAD];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAP_X;

    // 3. 縦の位置。
    let cursor = PAD;
    for (const top of tops) {
      measure(top);
      place(top, cursor, colX);
      cursor += top.block + GAP_TOPIC;
    }

    // 4. 反映。位置を決め、線を引く。
    for (const entry of entries) {
      entry.el.style.left = `${entry.x}px`;
      entry.el.style.top = `${entry.y}px`;
    }
    const width = Math.max(...entries.map((e) => e.x + e.w)) + PAD;
    const height = Math.max(...entries.map((e) => e.y + e.h)) + PAD;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = `scale(${state.zoom})`;
    stage.style.width = `${width * state.zoom}px`;
    stage.style.height = `${height * state.zoom}px`;
    canvas.prepend(drawLines(entries, width, height));
    return stage;
  }

  global.Mindra = Object.assign(global.Mindra || {}, { renderMindmap });
})(globalThis);

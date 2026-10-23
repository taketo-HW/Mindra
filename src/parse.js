// MD → 木構造。描画には依存しない純粋な変換。
// 書式の規則は docs/MD書式仕様.md を参照。
// file:// で動くように ES モジュールではなく通常のスクリプトとして読み込み、
// window.Mindra に登録する。
(function (global) {
  'use strict';

  // 木の形: { text, kind: 'root' | 'heading' | 'item', level?, children: [],
  //          line?, raw?, endLine? }
  // line は元の MD の行番号（0 始まり）、raw はその行の内容。書き戻しに使う。
  // endLine は、そのノードの子孫のうち最後の行。ルートがファイル名のときは line を持たない。

  function stripInline(s) {
    return s
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .trim();
  }

  // 行末の色の指定 {color:#rrggbb} を外して、色を返す。
  const COLOR_TAG = /\s*\{color:\s*(#[0-9a-fA-F]{6})\}\s*$/;
  function splitColor(s) {
    const m = COLOR_TAG.exec(s);
    return m ? { label: s.slice(0, m.index).trim(), color: m[1] } : { label: s, color: null };
  }

  // 先頭の front matter を外し、view の値と本文の開始行を取り出す。
  function splitFrontMatter(lines) {
    if (lines[0] !== '---') return { view: null, start: 0 };
    const end = lines.indexOf('---', 1);
    if (end === -1) return { view: null, start: 0 };
    let view = null;
    for (const line of lines.slice(1, end)) {
      const m = /^view:\s*(.*)$/.exec(line.trim());
      if (m) view = m[1].trim();
    }
    return { view, start: end + 1 };
  }

  function parseMarkdown(text, fileName) {
    // 先頭の BOM（メモ帳などで保存されたファイル）は取り除く。
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const fm = splitFrontMatter(lines);
    const warning =
      fm.view && fm.view !== 'mindmap'
        ? `view: ${fm.view} is not supported yet. Showing it as a mind map.`
        : null;

    const doc = { text: '', kind: 'root', children: [] };
    const stack = []; // 開いている見出し・箇条書き: { node, kind, level | indent }
    let fence = null; // コードブロックの中なら、開始したフェンス記号
    let open = null; // 直前のノードと、そのコメントの最後の行（コメントは直後の引用だけ）

    const attach = (node) => {
      const parent = stack.length ? stack[stack.length - 1].node : doc;
      parent.children.push(node);
    };

    for (let i = fm.start; i < lines.length; i++) {
      const line = lines[i];
      // ノードの直下に続く引用（> ）は、そのノードのコメント。木の要素にはしない。
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (open && quote && i === open.end + 1) {
        if (!open.node.comment) open.node.comment = [];
        open.node.comment.push(quote[1]);
        open.node.commentEnd = i;
        open.end = i;
        continue;
      }
      open = null;

      const fenceMatch = /^\s*(```|~~~)/.exec(line);
      if (fence) {
        if (fenceMatch && fenceMatch[1] === fence) fence = null;
        continue;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const { label, color } = splitColor(stripInline(heading[2]));
        if (!label) continue;
        // 見出しは、すべての箇条書きと、自分以上の深さの見出しを閉じる。
        while (
          stack.length &&
          (stack[stack.length - 1].kind === 'item' || stack[stack.length - 1].level >= level)
        ) {
          stack.pop();
        }
        const node = { text: label, kind: 'heading', level, children: [], line: i, raw: line, color };
        attach(node);
        stack.push({ node, kind: 'heading', level });
        open = { node, end: i };
        continue;
      }

      const item = /^(\s*)-\s+(.*)$/.exec(line);
      if (item) {
        const indent = item[1].length;
        const { label, color } = splitColor(stripInline(item[2]));
        if (!label) continue;
        // 同じか深いインデントの箇条書きは閉じる。
        while (
          stack.length &&
          stack[stack.length - 1].kind === 'item' &&
          stack[stack.length - 1].indent >= indent
        ) {
          stack.pop();
        }
        const node = { text: label, kind: 'item', children: [], line: i, raw: line, color };
        attach(node);
        stack.push({ node, kind: 'item', indent });
        open = { node, end: i };
      }
    }

    // 各ノードの最後の子孫の行を求める（書き戻しで挿入位置に使う）。
    const finish = (node) => {
      let end = node.line === undefined ? -1 : node.line;
      if (node.commentEnd !== undefined) end = Math.max(end, node.commentEnd);
      for (const child of node.children) end = Math.max(end, finish(child));
      node.endLine = end;
      return end;
    };
    doc.children.forEach(finish);

    // 一番上の題目: # 見出しは、どれも別の一番上の題目になる（中心の子にはしない）。
    // 最初の # より前の内容は、ファイル名の題目にまとめる。# が 1 つもなければ、ファイル名の題目だけになる。
    const roots = [];
    const pre = [];
    for (const n of doc.children) {
      if (n.kind === 'heading' && n.level === 1) {
        n.kind = 'root';
        roots.push(n);
      } else if (roots.length) {
        roots[roots.length - 1].children.push(n);
      } else {
        pre.push(n);
      }
    }
    if (pre.length || roots.length === 0) {
      const end = pre.length ? Math.max(...pre.map((n) => n.endLine)) : lines.length - 1;
      roots.unshift({ text: fileName, kind: 'root', children: pre, endLine: end });
    }
    return { view: fm.view || 'mindmap', warning, roots, root: roots[0] };
  }

  // 画面上の id（"0.1.2" 形式。先頭は一番上の題目の番号）からノードを探す。
  // roots は一番上の題目の一覧（1 つだけなら、その題目を渡してもよい）。
  function nodeAt(roots, id) {
    const list = Array.isArray(roots) ? roots : [roots];
    const [first, ...rest] = id.split('.');
    let node = list[Number(first)];
    for (const part of rest) node = node && node.children[Number(part)];
    return node;
  }

  // 元の行番号から、そのノードの id を探す。見つからなければ null。
  function findPathByLine(roots, line) {
    const list = Array.isArray(roots) ? roots : [roots];
    const find = (node, path) => {
      if (node.line === line) return path;
      for (let i = 0; i < node.children.length; i++) {
        const found = find(node.children[i], `${path}.${i}`);
        if (found) return found;
      }
      return null;
    };
    for (let i = 0; i < list.length; i++) {
      const found = find(list[i], String(i));
      if (found) return found;
    }
    return null;
  }

  // 新規ファイルの初期内容。view は図の種類（今はマインドマップだけ）。
  function newDocumentText(view, title) {
    return `---\nview: ${view}\n---\n\n# ${title}\n`;
  }

  global.Mindra = Object.assign(global.Mindra || {}, {
    parseMarkdown,
    newDocumentText,
    nodeAt,
    findPathByLine,
  });
})(globalThis);

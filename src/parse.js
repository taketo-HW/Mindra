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

    // ルート: 最初の # 見出し。無ければファイル名。
    const first = doc.children.findIndex((n) => n.kind === 'heading' && n.level === 1);
    if (first === -1) {
      const root = {
        text: fileName,
        kind: 'root',
        children: doc.children,
        endLine: lines.length - 1,
      };
      return { view: fm.view || 'mindmap', warning, root };
    }
    // ルートより前の要素と、2 つ目以降の # 見出しはルートの子になる。
    // 最初の # の子は、その位置に入れる（文書の順序を保つ）。
    const top = doc.children[first];
    const root = {
      text: top.text,
      kind: 'root',
      line: top.line,
      raw: top.raw,
      color: top.color,
      comment: top.comment,
      commentEnd: top.commentEnd,
      endLine: top.endLine,
      children: [
        ...doc.children.slice(0, first),
        ...top.children,
        ...doc.children.slice(first + 1),
      ],
    };
    return { view: fm.view || 'mindmap', warning, root };
  }

  // 画面上の id（"0.1.2" 形式。ルートが "0"）からノードを探す。
  function nodeAt(tree, id) {
    let node = tree;
    for (const part of id.split('.').slice(1)) {
      node = node && node.children[Number(part)];
    }
    return node;
  }

  // 元の行番号から、そのノードの id を探す。見つからなければ null。
  function findPathByLine(tree, line, path = '0') {
    if (tree.line === line) return path;
    for (let i = 0; i < tree.children.length; i++) {
      const found = findPathByLine(tree.children[i], line, `${path}.${i}`);
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

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

  // 図の種類（front matter の view）。書き方は docs/図の種類.md。
  const VIEWS = [
    'mindmap', 'flowchart', 'table', 'sequence', 'timeline',
    'kanban', 'roadmap', 'checklist', 'bar', 'pie', 'line', 'swot', 'logictree',
    'gantt', 'radar', 'quadrant', 'scatter', 'orgchart', 'state', 'fishbone', 'er',
    'network', 'swimlane', 'pyramid', 'funnel', 'gauge', 'heatmap', 'calendar',
  ];

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

  // ---- ほかの図（フローチャートなど）が使う共通の部品 ----

  // 表示する文字: インラインの記号と、行末の印（{color:...}、{ai:...}）を外す。
  function plainText(s) {
    let text = stripInline(String(s));
    for (let prev = null; prev !== text; ) {
      prev = text;
      text = text.replace(/\s*\{(color|ai):[^}]*\}\s*$/i, '');
    }
    return text.trim();
  }

  // 本文の行（front matter と、コードブロックの中を除く）。{ text, line } の並び。
  function documentLines(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const fm = splitFrontMatter(lines);
    const out = [];
    let fence = null;
    for (let i = fm.start; i < lines.length; i++) {
      const fenceMatch = /^\s*(```|~~~)/.exec(lines[i]);
      if (fence) {
        if (fenceMatch && fenceMatch[1] === fence) fence = null;
        continue;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        continue;
      }
      out.push({ text: lines[i], line: i });
    }
    return { view: fm.view || 'mindmap', lines: out };
  }

  // 区切り: ## 以下の見出しごとに、箇条書きをまとめる。最初の ## より前の箇条書きは、名前なしの区切りに入る。
  // 箇条書きは { text（記号を残した本文）, indent（字下げの空白の数） }。
  function documentSections(text) {
    const sections = [];
    let current = null;
    for (const { text: line } of documentLines(text).lines) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        if (heading[1].length >= 2) {
          current = { title: plainText(heading[2]), items: [] };
          sections.push(current);
        }
        continue;
      }
      const item = /^(\s*)-\s+(.*)$/.exec(line);
      if (!item) continue;
      if (!current) {
        current = { title: '', items: [] };
        sections.push(current);
      }
      current.items.push({ text: item[2], indent: item[1].length });
    }
    return sections;
  }

  // 数の行: 「- 名前: 数」。右側の最初の数を使う（1,200 や 3.5 も可）。負の数は 0。
  function numberRows(text) {
    const rows = [];
    for (const { text: line } of documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line);
      if (!item) continue;
      const m = /^(.*?)\s*(?::\s|：)\s*(.*)$/.exec(item[1]);
      if (!m) continue;
      const num = /-?\d[\d,]*(?:\.\d+)?/.exec(m[2]);
      const label = plainText(m[1]);
      if (!num || !label) continue;
      rows.push({ label, value: Math.max(0, Number(num[0].replace(/,/g, ''))) });
    }
    return rows;
  }

  // 題名: 最初の # 見出し。無ければファイル名。
  function documentTitle(text, fileName) {
    for (const { text: line } of documentLines(text).lines) {
      const m = /^#\s+(.*)$/.exec(line);
      if (m && plainText(m[1])) return plainText(m[1]);
    }
    return fileName;
  }

  function parseMarkdown(text, fileName) {
    // 先頭の BOM（メモ帳などで保存されたファイル）は取り除く。
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const fm = splitFrontMatter(lines);
    const warning =
      fm.view && !VIEWS.includes(fm.view)
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

  // 新規ファイルの初期内容。view は図の種類。マインドマップ以外は、書き方の見本を 1 つ入れる。
  const STARTERS = {
    flowchart: '- 開始 -> 終了\n',
    table: '| 項目 | 内容 |\n| :--- | :--- |\n| 例 | ここに書く |\n',
    sequence: '- A -> B: こんにちは\n- B --> A: 返事\n',
    timeline: '- 2026-01: はじめ\n',
    kanban: '## 未着手\n- カード\n## 作業中\n## 完了\n',
    roadmap: '## Q1\n- やること\n## Q2\n- やること\n',
    checklist: '- [ ] やること\n- [x] 済んだこと\n',
    bar: '- A: 30\n- B: 20\n',
    pie: '- A: 60\n- B: 40\n',
    line: '- 1月: 10\n- 2月: 20\n',
    swot: '## 強み\n- 項目\n## 弱み\n- 項目\n## 機会\n- 項目\n## 脅威\n- 項目\n',
    logictree: '## 要素\n- 中身\n',
    gantt: '## 作業\n- 設計: 2026-01-05 ~ 2026-01-16\n- 実装: 2026-01-19 ~ 2026-02-06\n',
    radar: '## 案A\n- 速さ: 4\n- 安さ: 3\n- 質: 5\n',
    quadrant: '- 横軸: 効果\n- 縦軸: 手軽さ\n- 案A: 8, 7\n- 案B: 3, 5\n',
    scatter: '- A: 3, 8\n- B: 6, 4\n- C: 9, 7\n',
    orgchart: '## 部門1\n- 課A\n- 課B\n## 部門2\n- 課C\n',
    state: '- * -> 受付\n- 受付 -> 完了: 済\n- 完了 -> *\n',
    fishbone: '## 人\n- 原因\n## 機械\n- 原因\n## 方法\n- 原因\n## 材料\n- 原因\n',
    er: '## 表A\n- id: int PK\n- 名前: text\n## 表B\n- 表Aid: int FK\n\n- 表B -> 表A: 多対1\n',
    network: '- A -- B: 関係\n- B -> C\n',
    swimlane: '## 担当1\n- 手順1\n## 担当2\n- 手順2\n',
    pyramid: '- 上段\n- 中段\n- 下段\n',
    funnel: '- 段階1: 1000\n- 段階2: 400\n- 段階3: 100\n',
    gauge: '- 目標A: 72%\n- 目標B: 45 / 60\n',
    heatmap: '| 行 | 月 | 火 |\n| :-- | --: | --: |\n| 朝 | 12 | 8 |\n| 昼 | 40 | 35 |\n',
    calendar: '- 2026-01-05: 予定A\n- 2026-01-20: 予定B\n',
  };
  function newDocumentText(view, title) {
    const starter = STARTERS[view] ? `\n${STARTERS[view]}` : '';
    return `---\nview: ${view}\n---\n\n# ${title}\n${starter}`;
  }

  global.Mindra = Object.assign(global.Mindra || {}, {
    VIEWS,
    plainText,
    documentLines,
    documentTitle,
    documentSections,
    numberRows,
    parseMarkdown,
    newDocumentText,
    nodeAt,
    findPathByLine,
  });
})(globalThis);

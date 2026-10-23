// 図の操作 → MD の書き換え。純粋な関数で、ファイルには触らない。
// 変えるのは対象の 1 行（追加なら 1 行の挿入）だけ。他の行はそのまま残す。
// 戻り値は { text, line }（書き換え後の全文と、変えた行）か { error }。
(function (global) {
  'use strict';

  const STALE = 'The file changed outside the app, so the edit was cancelled. Please try again.';

  // 行に分けて、各行の改行（CRLF かどうか）を覚える。混ざったファイルでも、他の行の改行は変えない。
  function splitText(text) {
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const parts = text.slice(bom.length).split('\n');
    const lines = parts.map((p) => (p.endsWith('\r') ? p.slice(0, -1) : p));
    const crlf = parts.map((p) => p.endsWith('\r'));
    const endings = crlf.slice(0, -1);
    const dominant = endings.filter(Boolean).length * 2 > endings.length;
    return { bom, lines, crlf, dominant };
  }

  function joinText(s) {
    const last = s.lines.length - 1;
    return s.bom + s.lines.map((l, i) => (i < last && s.crlf[i] ? `${l}\r` : l)).join('\n');
  }

  // 行を差し替える。新しい行の改行は、newFlags（無ければ、ファイルの多い方の改行）にする。
  function spliceLines(s, start, count, newLines, newFlags = []) {
    // 末尾の後ろに足すときは、今の末尾にも改行が要る。
    if (start > s.lines.length - 1) s.crlf[s.lines.length - 1] = s.dominant;
    const flags = newLines.map((_, i) => (i < newFlags.length ? newFlags[i] : s.dominant));
    s.lines.splice(start, count, ...newLines);
    s.crlf.splice(start, count, ...flags);
  }

  // ファイルの末尾が、閉じていないコードブロックの中で終わっているか。
  function endsInCodeBlock(lines) {
    let fence = null;
    for (const l of lines) {
      const m = /^\s*(```|~~~)/.exec(l);
      if (fence) {
        if (m && m[1] === fence) fence = null;
      } else if (m) {
        fence = m[1];
      }
    }
    return fence !== null;
  }

  // 表示時と同じ行か確かめる。ファイルが外で変わっていたら、行がずれているおそれがあるので止める。
  function isCurrent(lines, node) {
    return node.line !== undefined && lines[node.line] === node.raw;
  }

  function cleanLabel(label) {
    const clean = String(label).trim();
    if (!clean) return { error: 'The name is empty' };
    if (/[\r\n]/.test(clean)) return { error: 'The name must be one line' };
    if (/\{color:\s*#[0-9a-fA-F]{6}\}\s*$/.test(clean)) {
      return { error: 'Use the color buttons to set a color, not {color:...} in the name' };
    }
    return { label: clean };
  }

  function indentOf(raw) {
    return raw.match(/^\s*/)[0].length;
  }

  function insertLine(s, at, raw) {
    spliceLines(s, at, 0, [raw]);
    return { text: joinText(s), line: at };
  }

  // ノードの名前を変える。見出しの # や箇条書きの - と、インデントは残す。
  function renameNode(text, node, label) {
    const clean = cleanLabel(label);
    if (clean.error) return clean;
    if (node.line === undefined) return { error: 'The file name root cannot be renamed here' };
    const s = splitText(text);
    if (!isCurrent(s.lines, node)) return { error: STALE };
    const prefix = /^(#{1,6}\s+|\s*-\s+)/.exec(node.raw)[1];
    // 色の指定は、名前を変えても残す。
    s.lines[node.line] = prefix + clean.label + colorTag(node.color);
    return { text: joinText(s), line: node.line };
  }

  // 項目の色。行末に {color:#rrggbb} として書く。
  function colorTag(color) {
    return color ? ` {color:${color}}` : '';
  }

  // 項目の色を変える。color が null なら、色の指定を消す。
  function setColor(text, node, color) {
    if (node.line === undefined) return { error: 'The file name root has no color' };
    if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'The color must be #rrggbb' };
    const s = splitText(text);
    if (!isCurrent(s.lines, node)) return { error: STALE };
    const prefix = /^(#{1,6}\s+|\s*-\s+)/.exec(node.raw)[1];
    const body = node.raw.slice(prefix.length).replace(/\s*\{color:\s*#[0-9a-fA-F]{6}\}\s*$/, '');
    s.lines[node.line] = prefix + body + colorTag(color && color.toLowerCase());
    return { text: joinText(s), line: node.line };
  }

  // 子を、まとめて追加する（labels は 1 件以上）。見出しの子は 1 段深い見出し、
  // 箇条書きの子は 2 つ深い箇条書きにする。挿入位置は子孫の最後の行の後ろ。
  function addChildren(text, node, labels) {
    const cleaned = labels.map(cleanLabel);
    const bad = cleaned.find((c) => c.error);
    if (bad) return bad;
    if (!cleaned.length) return { error: 'Nothing to add' };
    const s = splitText(text);
    let at;
    let raws;
    if (node.line === undefined) {
      // ファイル名の題目: 中の内容の後ろに見出しとして足す（ファイルの末尾なら、末尾の改行は残す）。
      if (endsInCodeBlock(s.lines)) return { error: 'The file ends inside a code block. Close it first.' };
      const last = s.lines.length - 1;
      if (node.endLine >= last) {
        at = s.lines[last] === '' ? last : s.lines.length;
      } else {
        at = node.endLine + 1;
      }
      raws = cleaned.map((c) => `## ${c.label}`);
    } else {
      if (!isCurrent(s.lines, node)) return { error: STALE };
      at = node.endLine + 1;
      if (node.kind === 'item') {
        const pad = ' '.repeat(indentOf(node.raw) + 2);
        raws = cleaned.map((c) => `${pad}- ${c.label}`);
      } else {
        // 6 段目の見出しは、これより深くできないので箇条書きにする。
        const level = node.kind === 'root' ? 1 : node.level;
        const prefix = level < 6 ? '#'.repeat(level + 1) : null;
        raws = cleaned.map((c) => (prefix ? `${prefix} ${c.label}` : `- ${c.label}`));
      }
    }
    // 見出しを足すときは、前の行が空行でなければ、空行で区切る。
    const needsBlank = raws[0].startsWith('#') && at > 0 && s.lines[at - 1].trim() !== '';
    if (needsBlank) raws.unshift('');
    spliceLines(s, at, 0, raws);
    return { text: joinText(s), line: at + (needsBlank ? 1 : 0) };
  }

  // 子を 1 件足す。
  function addChild(text, node, label) {
    return addChildren(text, node, [label]);
  }

  // 一番上の題目を、ファイルの末尾に足す（# 見出し）。前の行が空行でなければ、空行で区切る。
  // 中心の子にはならず、並んだ別の題目になる。
  function addTopic(text, label) {
    const clean = cleanLabel(label);
    if (clean.error) return clean;
    const s = splitText(text);
    if (endsInCodeBlock(s.lines)) return { error: 'The file ends inside a code block. Close it first.' };
    const last = s.lines.length - 1;
    const at = s.lines[last] === '' ? last : s.lines.length;
    const needsBlank = at > 0 && s.lines[at - 1].trim() !== '';
    const raws = needsBlank ? ['', `# ${clean.label}`] : [`# ${clean.label}`];
    spliceLines(s, at, 0, raws);
    return { text: joinText(s), line: at + raws.length - 1 };
  }

  // ノードのコメントを置き換える。コメントは、ノードの直下にある「> 」の行。空にすると消す。
  function setComment(text, node, comment) {
    if (node.line === undefined) return { error: 'The file name root cannot have a comment' };
    const s = splitText(text);
    if (!isCurrent(s.lines, node)) return { error: STALE };
    const oldCount = node.comment ? node.comment.length : 0;
    const pad = ' '.repeat(node.kind === 'item' ? indentOf(node.raw) + 2 : 0);
    const body = String(comment).replace(/\r\n/g, '\n').replace(/\s+$/, '');
    const lines = body ? body.split('\n').map((l) => (l ? `${pad}> ${l}` : `${pad}>`)) : [];
    spliceLines(s, node.line + 1, oldCount, lines);
    return { text: joinText(s), line: node.line };
  }

  global.Mindra = Object.assign(global.Mindra || {}, {
    renameNode,
    setColor,
    addChild,
    addChildren,
    addTopic,
    setComment,
    STALE_MESSAGE: STALE,
  });
})(globalThis);

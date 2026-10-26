// マインドマップ以外の図が使う、描画の共通部品。
// 図の種類ごとのファイル（view-*.js）は、Mindra.views.<名前> = { parse, render } を登録する。
//   parse(text, fileName) … MD → 図のデータ（純粋な変換。テストできる）
//   render(model, container, { zoom }) … 図のデータ → 画面。外側の要素を返す（大きさは拡大後）
// 書き方の規則は docs/図の種類.md。
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    return node;
  }

  // 図を描く場所を用意する。題名を上に出し、その下に中身を置く。
  // 中身を置いたら done() を呼ぶ。中身の大きさから、拡大縮小後の大きさを決める（マインドマップと同じ仕組み）。
  function frame(container, zoom, title) {
    const outer = el('div', 'mm'); // 拡大後の大きさを持つ（スクロールのため）
    const canvas = el('div', 'mm-canvas'); // 拡大前の大きさで並べ、scale で拡大する
    const wrap = el('div', 'vw-wrap');
    if (title) wrap.appendChild(el('h2', 'vw-title', title));
    canvas.appendChild(wrap);
    outer.appendChild(canvas);
    container.replaceChildren(outer);
    return {
      wrap,
      done() {
        // 小数点以下を切り捨てると、文字が折り返されることがあるので、切り上げる。
        const rect = wrap.getBoundingClientRect();
        const width = Math.ceil(rect.width) + 1;
        const height = Math.ceil(rect.height) + 1;
        const scale = zoom || 1;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.transform = `scale(${scale})`;
        outer.style.width = `${width * scale}px`;
        outer.style.height = `${height * scale}px`;
        return outer;
      },
    };
  }

  // 位置を指定して要素を置く場所（線は SVG、箱は HTML）。大きさは後で決める。
  function area(wrap) {
    const box = el('div', 'vw-area');
    const lines = svg('svg', { class: 'vw-lines' });
    box.appendChild(lines);
    wrap.appendChild(box);
    return {
      box,
      lines,
      size(width, height) {
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        lines.setAttribute('width', width);
        lines.setAttribute('height', height);
      },
    };
  }

  // 矢印の先（SVG の marker）。線は class で色を決める。
  function arrowMarker(svgRoot, id) {
    const defs = svg('defs');
    const marker = svg('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '8',
      markerHeight: '8',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'vw-arrowhead' }));
    defs.appendChild(marker);
    svgRoot.appendChild(defs);
    return `url(#${id})`;
  }

  // 文字の幅（px）。描く前に、場所の大きさを決めるために使う。
  let measureCanvas = null;
  function textWidth(text, fontSource) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    const style = getComputedStyle(fontSource);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return ctx.measureText(String(text)).width;
  }

  // グラフの色（明るいテーマでも暗いテーマでも見分けやすい 8 色）。順番に使う。
  const CHART_COLORS = ['#5b8def', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2bb5c7', '#e2b93b', '#8e9aaf'];

  global.Mindra = Object.assign(global.Mindra || {}, {
    views: (global.Mindra && global.Mindra.views) || {},
    viewKit: { el, svg, frame, area, arrowMarker, textWidth, SVG_NS, CHART_COLORS },
  });
})(globalThis);

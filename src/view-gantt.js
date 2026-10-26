// ガントチャート（view: gantt）。書き方は docs/図の種類.md。
// 「- 作業: 開始日 ~ 終了日」の行を、横棒で並べる。## は作業のまとまり（見出しの行を出す）。
(function (global) {
  'use strict';

  const DAY_MS = 86400000;
  const DAY_W = 14; // 1 日の幅
  const ROW_H = 28; // 1 行の高さ
  const HEAD_H = 28; // 上の目盛りの高さ
  const PAD = 12;

  // 'YYYY-MM-DD' → 1970-01-01 からの日数。読めない日付（2026-02-30 など）は null。
  function dayNumber(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const date = new Date(Date.UTC(y, mo, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo || date.getUTCDate() !== d) return null;
    return Math.round(date.getTime() / DAY_MS);
  }

  function dateText(day) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
  }

  // 1 行を読む。読めなければ null。
  function parseTask(text) {
    const M = global.Mindra;
    const m = /^(.*?)\s*(?::\s|：)\s*(.*)$/.exec(text);
    if (!m) return null;
    const name = M.plainText(m[1]);
    const dates = /^(\d{4}-\d{2}-\d{2})(?:\s*[~〜]\s*(\d{4}-\d{2}-\d{2}))?/.exec(m[2].trim());
    if (!name || !dates) return null;
    let start = dayNumber(dates[1]);
    let end = dates[2] ? dayNumber(dates[2]) : start;
    if (start === null || end === null) return null;
    if (end < start) [start, end] = [end, start]; // 逆なら入れ替える
    return { name, start: dateText(start), end: dateText(end) };
  }

  // MD → { title, start, end, sections: [{ title, tasks: [{ name, start, end }] }] }
  // start / end は全体の最初の日と最後の日（作業が無ければ null）。終了日はその日を含む。
  function parse(text, fileName) {
    const M = global.Mindra;
    const sections = [];
    let min = null;
    let max = null;
    for (const section of M.documentSections(text)) {
      const tasks = [];
      for (const item of section.items) {
        if (item.indent > 0) continue; // 入れ子は使わない
        const task = parseTask(item.text);
        if (!task) continue;
        tasks.push(task);
        const s = dayNumber(task.start);
        const e = dayNumber(task.end);
        if (min === null || s < min) min = s;
        if (max === null || e > max) max = e;
      }
      if (tasks.length) sections.push({ title: section.title, tasks });
    }
    return {
      title: M.documentTitle(text, fileName),
      start: min === null ? null : dateText(min),
      end: max === null ? null : dateText(max),
      sections,
    };
  }

  function svgText(K, x, y, value, cls, anchor) {
    const t = K.svg('text', { x, y, class: cls, 'text-anchor': anchor || 'start' });
    t.textContent = value;
    return t;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.sections.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No tasks yet. Write lines like: - Design: 2026-01-05 ~ 2026-01-16'));
      return f.done();
    }
    const first = dayNumber(model.start);
    const last = dayNumber(model.end);
    const days = last - first + 1;

    // 左の名前の列の幅は、いちばん長い名前に合わせる（測るため、一度置いてから外す）。
    const probeTask = K.el('span', 'vw-gantt-measure-task');
    const probeHead = K.el('span', 'vw-gantt-measure-head');
    f.wrap.append(probeTask, probeHead);
    let labelW = 60;
    for (const section of model.sections) {
      if (section.title) labelW = Math.max(labelW, K.textWidth(section.title, probeHead));
      for (const task of section.tasks) labelW = Math.max(labelW, K.textWidth(task.name, probeTask) + 12);
    }
    probeTask.remove();
    probeHead.remove();
    const left = PAD + Math.ceil(labelW) + 16;
    const plotW = Math.max(days * DAY_W, 120);
    const dayW = plotW / days;

    let rows = 0;
    for (const section of model.sections) rows += section.tasks.length + (section.title ? 1 : 0);
    const width = left + plotW + 48; // 右端の目盛りの文字が切れないように余白を取る
    const height = HEAD_H + rows * ROW_H + 8;
    const chart = K.svg('svg', { width, height, class: 'vw-gantt-chart' });
    const xOf = (day) => left + (day - first) * dayW;

    // 週の初め（月曜）の目盛り。1970-01-01 は木曜なので、(日数 + 3) % 7 === 0 が月曜。
    const grid = K.svg('g');
    chart.appendChild(grid);
    // 週が多いときは、文字が重ならないように間引く。
    const labelEvery = Math.max(1, Math.ceil(48 / (7 * dayW)));
    let weekIndex = 0;
    for (let day = first; day <= last + 1; day++) {
      if ((day + 3) % 7 !== 0) continue;
      const x = xOf(day);
      grid.appendChild(K.svg('line', { x1: x, y1: HEAD_H - 4, x2: x, y2: height - 4, class: 'vw-gantt-grid' }));
      if (weekIndex % labelEvery === 0) {
        grid.appendChild(svgText(K, x, HEAD_H - 10, dateText(day).slice(5), 'vw-gantt-axis', 'middle'));
      }
      weekIndex++;
    }
    // 全体の枠（最初の日の左端と、最後の日の右端）。
    grid.appendChild(K.svg('line', { x1: left, y1: HEAD_H - 4, x2: left, y2: height - 4, class: 'vw-gantt-edge' }));
    grid.appendChild(K.svg('line', { x1: left + plotW, y1: HEAD_H - 4, x2: left + plotW, y2: height - 4, class: 'vw-gantt-edge' }));

    let y = HEAD_H;
    model.sections.forEach((section, si) => {
      const color = K.CHART_COLORS[si % K.CHART_COLORS.length];
      if (section.title) {
        chart.appendChild(K.svg('rect', { x: PAD - 4, y: y + 2, width: width - PAD, height: ROW_H - 4, rx: 4, class: 'vw-gantt-headrow' }));
        chart.appendChild(svgText(K, PAD, y + ROW_H / 2 + 5, section.title, 'vw-gantt-head'));
        y += ROW_H;
      }
      for (const task of section.tasks) {
        const s = dayNumber(task.start);
        const e = dayNumber(task.end);
        chart.appendChild(svgText(K, PAD + 12, y + ROW_H / 2 + 5, task.name, 'vw-gantt-task'));
        const bar = K.svg('rect', {
          x: xOf(s),
          y: y + 6,
          width: Math.max(2, (e - s + 1) * dayW),
          height: ROW_H - 12,
          rx: 3,
          fill: color,
          class: 'vw-gantt-bar',
        });
        const tip = K.svg('title');
        tip.textContent = task.start === task.end ? `${task.name}: ${task.start}` : `${task.name}: ${task.start} ~ ${task.end}`;
        bar.appendChild(tip);
        chart.appendChild(bar);
        y += ROW_H;
      }
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.gantt = { parse, render };
})(globalThis);

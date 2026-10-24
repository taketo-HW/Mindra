// Orca のブラウザのタブを操作する関数。Orca の中で実行されているとき（ORCA_CLI_COMMAND がある）だけ使える。
// 使い方（手順は docs/Orca表示手順.md）:
//   import { openInOrcaTab, listOrcaTabs, closeOrcaTab, focusOrcaTab } from './orca.mjs';
// 外（普通の端末）から呼ばれたときは、何もせず false / 空の一覧を返す。

import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 30_000;

// Orca の実行ファイル。Orca の中で動いているときだけ値がある。
export function orcaCommand() {
  return process.env.ORCA_CLI_COMMAND || null;
}

function runOrca(args) {
  const orca = orcaCommand();
  if (!orca) return null;
  return spawnSync(orca, args, { encoding: 'utf8', timeout: TIMEOUT_MS });
}

// 新しいタブで URL を開く。成功したら true。MINDMAP_BROWSER=system のときは使わない。
export function openInOrcaTab(url) {
  if (process.env.MINDMAP_BROWSER === 'system') return false;
  const result = runOrca(['tab', 'create', '--url', url]);
  return Boolean(result && result.status === 0);
}

// `orca tab list` の出力（1 行 1 タブ）を、読みやすい形にする。
// 例: "* [1] 42710c2f-...  Mindra — http://127.0.0.1:7777/?file=..."
//   → { current, index, pageId, title, url }
export function parseTabList(text) {
  const tabs = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^(\*?)\s*\[(\d+)\]\s+(\S+)\s+(.*?)\s+—\s+(\S+)\s*$/.exec(line);
    if (m) tabs.push({ current: m[1] === '*', index: Number(m[2]), pageId: m[3], title: m[4], url: m[5] });
  }
  return tabs;
}

// いま開いているタブの一覧。Orca の外では空の一覧。
export function listOrcaTabs() {
  const result = runOrca(['tab', 'list']);
  return result && result.status === 0 ? parseTabList(result.stdout) : [];
}

// タブを閉じる（pageId で指定）。成功したら true。
export function closeOrcaTab(pageId) {
  const result = runOrca(['tab', 'close', '--page', pageId]);
  return Boolean(result && result.status === 0);
}

// タブを前に出す（pageId で指定）。成功したら true。
export function focusOrcaTab(pageId) {
  const result = runOrca(['tab', 'switch', '--page', pageId]);
  return Boolean(result && result.status === 0);
}

#!/usr/bin/env node
// mindmap: どのフォルダからでも打てるコマンド。
//   mindmap            … 新規作成（ブラウザで、新しい図を作る画面を開く）
//   mindmap <パス>      … その .md を、マインドマップとして開く（絶対パスも相対パスも可）
//   mindmap --orca <パス> … Orca のチャットに出す、表示専用の HTML を作る
// Orca の中で実行したときは、Orca のタブに開く（編集できる）。それ以外は、Chrome の新しいタブに開く。
// 補助プログラム（tools/ai-bridge.mjs）が動いていなければ、自動で起動する。

import { spawn, spawnSync } from 'node:child_process';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openInOrcaTab, orcaCommand } from './orca.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MINDRA_BRIDGE_PORT || 7777);
const BASE = `http://127.0.0.1:${PORT}`;

async function alive() {
  try {
    return (await fetch(`${BASE}/health`)).ok;
  } catch {
    return false;
  }
}

async function ensureBridge() {
  if (await alive()) return;
  const child = spawn(process.execPath, [join(HERE, 'ai-bridge.mjs')], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await alive()) return;
  }
  throw new Error('the Mindra bridge did not start');
}

// 開いているブラウザに、新しいタブで開かせる。
function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['google-chrome', ['--new-tab', url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const arg = process.argv[2];
  // mindmap --orca <パス>: Orca のチャットに出す、表示専用の HTML を作る（返信に貼る行を表示する）。
  if (arg === '--orca') {
    const target = process.argv[3];
    if (!target) {
      console.error('usage: mindmap --orca <file.md>');
      process.exit(1);
    }
    const result = spawnSync(process.execPath, [join(HERE, 'export-html.mjs'), resolve(process.cwd(), target)], {
      stdio: 'inherit',
    });
    process.exit(result.status ?? 1);
  }
  // dir は、打った場所（作業フォルダ）。新しく作るマインドマップは、ここに保存する。
  const dir = encodeURIComponent(process.cwd());
  let url;
  if (!arg) {
    url = `${BASE}/?new=1&dir=${dir}`;
  } else {
    const path = resolve(process.cwd(), arg);
    if (extname(path).toLowerCase() !== '.md') {
      console.error('mindmap: only .md files can be opened.');
      process.exit(1);
    }
    url = `${BASE}/?file=${encodeURIComponent(path)}&dir=${dir}`;
  }
  await ensureBridge();
  if (orcaCommand() && openInOrcaTab(url)) {
    console.log(`mindmap: opened in an Orca tab: ${url}`);
  } else {
    openBrowser(url);
    console.log(`mindmap: ${url}`);
  }
}

main().catch((err) => {
  console.error(`mindmap: ${err.message}`);
  process.exit(1);
});

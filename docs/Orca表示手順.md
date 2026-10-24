# Orca で図を表示・編集する手順

Orca の中で作業しているとき、マインドマップを Orca のタブで開く（編集できる）手順と、チャットに図を出す（表示専用）手順をまとめます。

## 前提

- このリポジトリ: `/work/Mindra`
- `mindmap` コマンドが使える（`~/.local/bin/mindmap` へのリンク）。
- Orca の中で実行すると、環境変数 `ORCA_CLI_COMMAND` が入っている。これがあるときだけ、Orca のタブを使う。
- 補助プログラム（`tools/ai-bridge.mjs`、127.0.0.1:7777）は、`mindmap` が自動で起動する。手で起動する必要はない。

## 1. 編集できる図を Orca のタブで開く

```
mindmap <ファイル.md>
```

- 絶対パスでも、今いるフォルダからの相対パスでもよい。`.md` だけ。
- Orca の中で実行すると、Orca のブラウザのタブに開く（`orca tab create`）。
- Orca の外で実行すると、Chrome の新しいタブに開く。
- Orca のタブを使わせないとき: `MINDMAP_BROWSER=system mindmap <ファイル.md>`

## 2. 開いているタブを確かめる

Orca の中で、関数を使う（`tools/orca.mjs`）。

```
node -e 'import("./tools/orca.mjs").then((o) => console.log(o.listOrcaTabs()))'
```

- 返ってくる配列の 1 件は、`{ current, index, pageId, title, url }`。
- `title` が `Mindra` のものが、マインドマップのタブ。`url` の `?file=` で、どのファイルか分かる。

## 3. 重複したタブを閉じる・前に出す

同じ関数で、`pageId` を指定する。

```
node -e 'import("./tools/orca.mjs").then((o) => o.closeOrcaTab("<pageId>"))'
node -e 'import("./tools/orca.mjs").then((o) => o.focusOrcaTab("<pageId>"))'
```

- `closeOrcaTab` と `focusOrcaTab` は、成功したら `true` を返す。

## 4. チャットの返信に図を出す（表示専用）

```
mindmap --orca <ファイル.md>
```

- 1 枚の HTML を、Orca のチャット用のフォルダ（`ORCA_CHAT_SCRATCH_DIR`）に作る。
- 表示された `::orca-visual{...}` の行を、返信にそのまま 1 行で書く。
- この図は表示専用（編集はできない）。外部への通信はしない。
- 折りたたみと、Fit / 100% の切り替えだけができる。

## 関数の一覧（`tools/orca.mjs`）

| 関数 | 役割 | 戻り値 |
| :--- | :--- | :--- |
| `orcaCommand()` | Orca の実行ファイル（`ORCA_CLI_COMMAND`）。Orca の外では `null` | 文字列 or `null` |
| `openInOrcaTab(url)` | Orca の新しいタブで URL を開く | 成功なら `true` |
| `listOrcaTabs()` | 開いているタブの一覧 | 配列（Orca の外では空） |
| `parseTabList(text)` | `orca tab list` の出力を、配列にする | 配列 |
| `closeOrcaTab(pageId)` | タブを閉じる | 成功なら `true` |
| `focusOrcaTab(pageId)` | タブを前に出す | 成功なら `true` |

テストは `npm test`（`tests/orca.test.js`）。

## うまくいかないとき

- **タブが開かない**: `echo $ORCA_CLI_COMMAND` が空でないか確かめる。空なら、Orca の外で実行されている。Chrome のタブに開く。
- **図が出ない・読み込みに失敗する**: 補助プログラムが動いているか確かめる（`curl -s http://127.0.0.1:7777/health` が `ok`）。動いていなければ、`mindmap <ファイル.md>` を打ち直す。
- **タブが増えすぎる**: `listOrcaTabs()` で `title` が `Mindra` のものを探し、`closeOrcaTab` で閉じる。
- **チャットに図が出ない**: `mindmap --orca` の出力の `::orca-visual{...}` が、コードブロックの中に入っていないか確かめる。1 行で、そのまま書く。

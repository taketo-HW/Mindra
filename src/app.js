// 画面の配線。ファイルを開き・作り、MD → 木 → 図 をつなぐ。
// 図の上の操作（選ぶ・名前を変える・追加）は、MD の書き換えに変えて保存する。
(function (global) {
  'use strict';

  const M = global.Mindra;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_LABEL = 'New item';
  const DEFAULT_TOPIC_LABEL = 'untitled';
  // 項目の色: 7 色のパステル。既定の色で、設定から変えられる（MD には #rrggbb で書く）。
  const PALETTE_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gray'];
  const DEFAULT_PALETTE = ['#ffb3ba', '#ffd3a5', '#fff1a8', '#c4f0c2', '#b5d8f7', '#d7c4f2', '#dcdfe4'];
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  const LINE_DEFAULT = '#8a96a3';

  const state = {
    roots: null, // 一番上の題目の一覧
    view: 'mindmap', // 図の種類（front matter の view）
    model: null, // マインドマップ以外の図のデータ
    text: '', // 今開いているファイルの内容（AI に渡す）
    fileName: '', // 今開いているファイルの名前
    dir: null, // 作業フォルダ（mindmap を打った場所）。新しい図はここに保存する
    collapsed: new Set(),
    zoom: 1,
    watcher: null,
    saving: false, // 書き戻し中
    open: false, // ファイルを開いているか
    selected: null, // 選んでいるノードの id
    editing: null, // 名前を編集中のノードの id
    menu: null, // ＊のメニューを開いているノードの id
    commenting: null, // コメントを編集中のノードの id
    editingNode: null, // 編集中のノードの行番号と中身（id が指す先が変わっても追えるように）
  };

  function setStatus(message) {
    $('status').textContent = message;
  }

  // マウスを押している間は描き直さない。名前の編集欄のフォーカスが外れると描き直しが起き、
  // 押したノードが消えて、離したときの click が別の要素に届いて失われるため。離した後に描き直す。
  let pointerHeld = false;
  let redrawWaiting = false;
  function redraw() {
    if (pointerHeld) redrawWaiting = true;
    else draw();
  }
  const releasePointer = () => {
    pointerHeld = false;
    if (redrawWaiting) {
      setTimeout(() => {
        if (!pointerHeld && redrawWaiting) {
          redrawWaiting = false;
          draw();
        }
      }, 0); // click は離した直後の同じ操作の中で届くので、その後に描く
    }
  };
  document.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);

  // 名前の編集を始める。編集中のノードは、パス（"0.1.2"）ではなく、行番号と中身で覚える。
  // パスは、外から行が増えると別のノードを指してしまうため。
  function beginEdit(id) {
    const node = id && M.nodeAt(state.roots, id);
    state.commenting = null;
    state.editing = node ? id : null;
    state.editingNode = node ? { line: node.line, raw: node.raw } : null;
  }

  // コメントの編集を始める。名前の編集と同じく、ノードの行番号と中身で覚える。
  function beginComment(id) {
    const node = id && M.nodeAt(state.roots, id);
    state.editing = null;
    state.commenting = node ? id : null;
    state.editingNode = node ? { line: node.line, raw: node.raw } : null;
  }

  // マインドマップ以外の図か（見るだけ。編集は MD を直接書く）。
  function isOtherView() {
    return state.view !== 'mindmap';
  }

  function draw() {
    if (!state.roots) return;
    if (isOtherView()) {
      M.views[state.view].render(state.model, $('view'), { zoom: state.zoom });
      return;
    }
    M.renderMindmap(state.roots, $('view'), {
      collapsed: state.collapsed,
      selected: state.selected,
      editing: state.editing,
      commenting: state.commenting,
      menu: state.menu,
      palette: settings.palette,
      onMenu(id) {
        state.menu = state.menu === id ? null : id;
        draw();
      },
      onColor(id, color) {
        state.menu = null;
        setNodeColor(color, id);
      },
      zoom: state.zoom,
      onSelect(id) {
        state.selected = id;
        state.menu = null;
        state.editing = null;
        state.commenting = null;
        draw();
      },
      onEdit(id) {
        state.selected = id;
        beginEdit(id);
        draw();
      },
      onToggle(id) {
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        draw();
      },
      onRename: rename,
      chatOpen: chatOpen(),
      onAddAI(id) {
        state.menu = null;
        attachAI(id);
      },
      onComment(id) {
        state.selected = id;
        state.menu = null;
        beginComment(id);
        draw();
      },
      onSaveComment: saveComment,
      onCancelEdit() {
        state.editing = null;
        state.commenting = null;
        draw();
      },
      onAddChild: addChild,
    });
    updateSwatches();
  }

  // ファイルを開いていないときは、ファイルに対する操作を使えないようにする。
  // 「Settings」「New」「Open MD file」は、いつでも使える。
  const FILE_CONTROLS = ['add-child', 'add-topic', 'rename', 'zoom-in', 'zoom-out'];
  function setFileControls(enabled) {
    state.open = enabled;
    for (const id of FILE_CONTROLS) $(id).disabled = !enabled;
    updateEditControls();
    updateSwatches();
  }

  // 編集のボタンは、マインドマップのときだけ使える（ほかの図は、まだ見るだけ）。
  const EDIT_CONTROLS = ['add-child', 'add-topic', 'rename'];
  function updateEditControls() {
    const editable = state.open && !isOtherView();
    for (const id of EDIT_CONTROLS) $(id).disabled = !editable;
  }

  // 項目の色の見本。項目を選んでいるときだけ使える。
  function updateSwatches() {
    const node = state.selected && state.roots && M.nodeAt(state.roots, state.selected);
    const usable = Boolean(state.open && !isOtherView() && node && node.line !== undefined);
    for (const button of document.querySelectorAll('.swatch')) button.disabled = !usable;
  }

  // 項目の色を変える（null なら色を消す）。id を省けば、選んでいる項目。
  async function setNodeColor(color, id = state.selected) {
    if (isOtherView()) return;
    const node = id && M.nodeAt(state.roots, id);
    if (!node) {
      setStatus('Select a node first');
      return;
    }
    await commit((text) => M.setColor(text, node, color));
    redraw();
  }

  function buildSwatches() {
    const box = $('item-swatches');
    box.replaceChildren();
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'swatch swatch-none';
    none.textContent = '×';
    none.title = 'No color';
    none.addEventListener('click', () => setNodeColor(null));
    box.appendChild(none);
    settings.palette.forEach((hex, i) => {
      const name = PALETTE_NAMES[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = hex;
      button.title = name;
      button.addEventListener('click', () => setNodeColor(hex));
      box.appendChild(button);
    });
  }

  // 設定。ブラウザに保存する（MD には書かない）。null は「テーマの既定」。
  const THEMES = ['system', 'light', 'dark', 'black', 'pink', 'blue', 'green'];
  const FONTS = {
    system: 'system-ui, -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif',
    mincho: '"Hiragino Mincho ProN", "Yu Mincho", serif',
    rounded: '"Hiragino Maru Gothic ProN", "Rounded Mplus 1c", "Arial Rounded MT Bold", sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  };
  const defaultSettings = () => ({
    theme: 'light',
    font: 'system',
    line: null,
    text: null,
    comment: null,
    palette: DEFAULT_PALETTE.slice(),
  });
  let settings = defaultSettings();

  function loadSettings() {
    const base = defaultSettings();
    try {
      const saved = JSON.parse(localStorage.getItem('mindra.settings') || '{}');
      const theme = THEMES.includes(saved.theme) ? saved.theme : base.theme;
      const palette =
        Array.isArray(saved.palette) && saved.palette.length === 7 && saved.palette.every(isHex)
          ? saved.palette
          : base.palette;
      return { ...base, ...saved, theme, palette };
    } catch {
      return base;
    }
  }

  function saveSettings() {
    localStorage.setItem('mindra.settings', JSON.stringify(settings));
  }

  // System は、OS の設定に従って明るい / 暗いを選ぶ。
  function resolvedTheme() {
    if (settings.theme === 'system') {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
  }

  function setOverride(name, value) {
    const root = document.documentElement;
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }

  // 設定を画面に反映し、ダイアログの値も合わせる。
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme();
    root.style.setProperty('--font', FONTS[settings.font] || FONTS.system);
    setOverride('--line', settings.line);
    setOverride('--fg', settings.text);
    setOverride('--comment-fg', settings.comment);
    const shown = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    $('set-theme').value = settings.theme;
    $('set-font').value = settings.font;
    $('set-line').value = shown('--line');
    $('set-text').value = shown('--fg');
    $('set-comment').value = shown('--comment-fg');
    settings.palette.forEach((hex, i) => {
      document.querySelectorAll('.palette-input')[i].value = hex;
    });
  }

  // 設定ダイアログに、項目の 7 色の入力欄を並べる。
  function buildPaletteInputs() {
    const box = $('set-palette');
    PALETTE_NAMES.forEach((name, i) => {
      const label = document.createElement('label');
      label.textContent = `${name} item`;
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'palette-input';
      input.addEventListener('input', () => {
        settings.palette[i] = input.value;
        saveSettings();
        buildSwatches();
        updateSwatches();
      });
      label.appendChild(input);
      box.appendChild(label);
    });
  }

  function changeSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
  }

  // 設定は開いたままのパネル（モーダルではない）。開いたままでも、マップの項目を選べる。
  function openSettings() {
    applySettings();
    $('settings-dialog').show();
  }

  function resetSettings() {
    settings = defaultSettings();
    saveSettings();
    applySettings();
    buildSwatches(); // 項目の色の見本も、既定の色に戻す
    updateSwatches();
  }

  function onText(text, fileName) {
    const name = fileName.replace(/\.md$/i, '');
    const { warning, roots, view } = M.parseMarkdown(text, name);
    state.roots = roots;
    state.view = view !== 'mindmap' && M.views[view] ? view : 'mindmap';
    state.model = isOtherView() ? M.views[state.view].parse(text, name) : null;
    updateEditControls();
    state.text = text;
    state.fileName = fileName;
    if (!state.selected || !M.nodeAt(roots, state.selected)) state.selected = '0';
    // 編集中に外から書き換わった場合: 同じノードを追えたら編集を続け、追えなければ取り消す。
    let notice = null;
    if (state.editing || state.commenting) {
      const key = state.editingNode;
      const id = key && key.line !== undefined ? M.findPathByLine(roots, key.line) : null;
      const node = id && M.nodeAt(roots, id);
      if (node && node.raw === key.raw) {
        if (state.editing) state.editing = id;
        if (state.commenting) state.commenting = id;
        state.editingNode = { line: node.line, raw: node.raw };
      } else {
        state.editing = null;
        state.commenting = null;
        state.editingNode = null;
        notice = 'The file changed while you were editing, so the edit was cancelled.';
      }
    }
    redraw();
    setStatus(notice || warning || `Showing ${fileName} (changes apply automatically)`);
  }

  function onError(err) {
    setStatus(`Failed to read the file: ${err.message}`);
  }

  // 既存のファイルや新規ファイルの監視を入れ替える。
  // 新しいファイルが決まるまでは、今の監視を続ける（キャンセルしても表示は変わらない）。
  async function startWatching(start) {
    let next;
    try {
      next = await start(onText, onError);
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Could not open the file: ${err.message}`);
      return;
    }
    if (state.watcher) state.watcher.stop();
    state.watcher = next;
    setFileControls(true);
    state.collapsed = new Set();
    state.selected = null;
    state.editing = null;
    state.commenting = null;
    chat.focus = null; // 前のファイルの行は、添えない
    renderChatFocus();
  }

  function onOpen() {
    return startWatching((onChange, onErr) => M.watchFile(onChange, onErr));
  }

  // 新規作成: 図の種類を選んでから、保存先を聞く。
  function onNew() {
    $('new-dialog').showModal();
  }

  function onNewConfirm(event) {
    event.preventDefault();
    const view = document.querySelector('input[name="view"]:checked').value;
    $('new-dialog').close();
    return startWatching((onChange, onErr) => M.createFile(view, onChange, onErr));
  }

  // MD を書き換えて保存する。失敗したら理由を出し、null を返す。
  // 保存の途中は次の操作を受け付けない（古い木を基にした操作が混ざるのを防ぐ）。
  async function commit(fn) {
    if (!state.watcher) {
      setStatus('Open a file first');
      return null;
    }
    if (state.saving) {
      // 前の保存が終わるまで待ってもらう（操作は捨てるので、やり直してもらう）。
      setStatus('Still saving the previous change. Please try again.');
      return null;
    }
    state.saving = true;
    setStatus('Saving…');
    let result;
    try {
      result = await state.watcher.edit(fn);
    } catch (err) {
      setStatus(`Failed to save: ${err.message}`);
      return null;
    } finally {
      state.saving = false;
    }
    if (result.error) {
      setStatus(result.error);
      return null;
    }
    setStatus('Saved');
    return result;
  }

  // コメントを保存する。内容が変わっていなければ書かない。空にすると、コメントは消える。
  async function saveComment(id, value) {
    if (state.commenting !== id) return;
    state.commenting = null;
    const node = M.nodeAt(state.roots, id);
    const before = node && (node.comment || []).join('\n');
    if (!node || value.replace(/\s+$/, '') === before) {
      draw();
      return;
    }
    await commit((text) => M.setComment(text, node, value));
    draw();
  }

  async function rename(id, label) {
    // 編集がすでに取り消されていれば（外からの変更で止めた後など）、古いパスで書き換えない。
    if (state.editing !== id) return;
    state.editing = null;
    const node = M.nodeAt(state.roots, id);
    // 変えていなければ書かない（マークダウン記号を消さないため）。
    if (!node || label.trim() === node.text) {
      redraw();
      return;
    }
    await commit((text) => M.renameNode(text, node, label));
    redraw();
  }

  // 指定したノードに子を足す。足した子の名前を、すぐ編集できる状態にする。
  async function addChild(id) {
    if (isOtherView()) return;
    const node = id && M.nodeAt(state.roots, id);
    if (!node) {
      setStatus('Select a node first');
      return;
    }
    state.editing = null;
    const result = await commit((text) => M.addChild(text, node, DEFAULT_LABEL));
    if (result) {
      // 足した子が見えるように、その祖先（畳まれている所）をすべて開く。
      const newId = M.findPathByLine(state.roots, result.line);
      if (newId) {
        const parts = newId.split('.');
        for (let i = 1; i < parts.length; i++) state.collapsed.delete(parts.slice(0, i).join('.'));
        state.selected = newId;
        beginEdit(newId);
      }
    }
    redraw();
  }

  // 「Add topic」: 一番上の題目を、ファイルの末尾に足す（既定の名前は untitled）。選択には依存しない。
  async function addTopic() {
    if (isOtherView()) return;
    state.editing = null;
    const result = await commit((text) => M.addTopic(text, DEFAULT_TOPIC_LABEL));
    if (result) {
      const newId = M.findPathByLine(state.roots, result.line);
      if (newId) {
        state.selected = newId;
        beginEdit(newId);
      }
    }
    redraw();
  }

  // AI チャット（右側のパネル）。AI へは、補助プログラム（tools/ai-bridge.mjs、npm run bridge）経由で話す。
  const CHAT_NAMES = { claude: 'Claude', codex: 'Codex', ollama: 'Ollama' };
  const BRIDGE_URL = 'http://127.0.0.1:7777';
  const chat = { ai: 'claude', focus: null }; // focus: チャットに添えた行

  function chatOpen() {
    return !$('chat-panel').hidden;
  }

  function toggleChat() {
    $('chat-panel').hidden = !$('chat-panel').hidden;
    redraw();
  }

  function setChatAI(ai) {
    chat.ai = ai;
    for (const button of document.querySelectorAll('.chat-ai-btn')) {
      button.classList.toggle('is-on', button.dataset.ai === ai);
    }
  }

  function appendChat(role, text) {
    const message = document.createElement('p');
    message.className = `chat-msg chat-${role}`;
    message.textContent = text;
    $('chat-log').appendChild(message);
    message.scrollIntoView({ block: 'end' });
    return message;
  }

  function renderChatFocus() {
    const box = $('chat-focus');
    box.hidden = !chat.focus;
    if (chat.focus) {
      const where = chat.focus.line ? `${chat.focus.file}, line ${chat.focus.line}` : chat.focus.file;
      box.querySelector('span').textContent = `${where} · ${chat.focus.text}`;
    }
  }

  // AI に送って、答えを表示する。添えた行があれば、それも一緒に送る。
  async function askAI(text) {
    const ai = chat.ai;
    const reply = appendChat('note', `${CHAT_NAMES[ai]} is thinking…`);
    const f = chat.focus;
    const focus = f ? `${f.file}${f.line ? `, line ${f.line}` : ''} ("${f.text}"): ${f.raw}` : '';
    try {
      const res = await fetch(`${BRIDGE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai, message: text, context: state.text || '', focus }),
      });
      const data = await res.json();
      reply.className = 'chat-msg chat-ai';
      reply.textContent = res.ok ? data.reply : `Error: ${data.error}`;
      const proposed = res.ok ? extractMarkdown(data.reply) : null;
      if (proposed) {
        addApplyButton(reply, proposed);
        addSaveButton(reply, proposed);
      }
    } catch (err) {
      reply.textContent = 'Could not reach the AI bridge. Start it in a terminal with: npm run bridge';
    }
    reply.scrollIntoView({ block: 'end' });
  }

  async function sendChat(event) {
    event.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    $('chat-input').value = '';
    appendChat('user', text);
    await askAI(text);
  }

  // ＊の「Add chat」: その行をチャットに添えて、入力欄で人間が続けて打てるようにする（AI には送らない）。
  function attachAI(id) {
    const node = M.nodeAt(state.roots, id);
    if (!node || !chatOpen()) return;
    chat.focus = {
      file: state.fileName,
      line: node.line === undefined ? null : node.line + 1,
      text: node.text,
      raw: node.raw || node.text,
    };
    renderChatFocus();
    const input = $('chat-input');
    input.value = `${input.value.trimEnd()}\n`; // 1 つ改行を入れて、人間がそこから打てるように
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    redraw();
  }

  // AI の答えの中から、ファイル全体の新しい内容（```markdown のブロック）を取り出す。
  function extractMarkdown(reply) {
    const m = /```markdown\n([\s\S]*?)\n```/.exec(reply || '');
    return m ? m[1] : null;
  }

  // 答えに付ける「ファイルに反映」。押したときだけ、確認のあとに書き込む。
  function addApplyButton(reply, markdown) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-apply';
    button.textContent = 'Apply to file';
    button.title = 'Replace the whole file with this version (asks first)';
    button.addEventListener('click', async () => {
      if (!state.watcher) {
        setStatus('Open a file first');
        return;
      }
      if (!window.confirm('Replace the whole file with this version?')) return;
      await commit(() => ({ text: markdown, line: 0 }));
      redraw();
    });
    reply.appendChild(button);
  }

  // 答えの図を、新しいファイルとして保存する（作業フォルダに。フォルダが無ければ選んでもらう）。
  function addSaveButton(reply, markdown) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-apply';
    button.textContent = 'Save as new map';
    button.title = 'Save this as a new .md file in your working folder';
    button.addEventListener('click', () => saveAsNewMap(markdown));
    reply.appendChild(button);
  }

  async function saveAsNewMap(markdown) {
    const heading = /^#\s+(.+)$/m.exec(markdown);
    const title = heading ? heading[1].trim() : 'untitled';
    if (state.dir) {
      // 作業フォルダがある: 補助プログラムに保存してもらい、新しいタブで開く。
      try {
        const res = await fetch(`${BRIDGE_URL}/new-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: state.dir, title, text: markdown }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error);
          return;
        }
        setStatus(`Saved ${data.path}`);
        global.open(`${BRIDGE_URL}/?file=${encodeURIComponent(data.path)}&dir=${encodeURIComponent(state.dir)}`, '_blank');
      } catch (err) {
        setStatus('Could not reach the AI bridge. Start it with: mindmap');
      }
      return;
    }
    // 作業フォルダが分からない（ファイル選択で開いた）: フォルダを選んでもらい、そこに保存する。
    if (typeof global.showDirectoryPicker !== 'function') {
      setStatus('Choose a folder is not supported here. Open the map with the mindmap command instead.');
      return;
    }
    try {
      const folder = await global.showDirectoryPicker({ mode: 'readwrite' });
      const name = `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'untitled'}.md`;
      const exists = await folder.getFileHandle(name).then(() => true, () => false);
      if (exists) {
        setStatus(`${name} already exists in that folder`);
        return;
      }
      const handle = await folder.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(markdown);
      await writable.close();
      setStatus(`Saved ${name} in the chosen folder. Open it with: mindmap ${name}`);
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Could not save: ${err.message}`);
    }
  }

  function startRename() {
    if (isOtherView()) return;
    if (!state.selected) {
      setStatus('Select a node first');
      return;
    }
    beginEdit(state.selected);
    draw();
  }

  // キーボード: Tab で子を追加、Enter で名前を編集（名前の編集中は無効）。
  // 図の上（本体か図の領域）にフォーカスがあるときだけ働く。ツールバーやダイアログのボタンは、普通に使えるようにする。
  function onKeyDown(event) {
    const t = event.target;
    const onCanvas = t === document.body || (t.closest && t.closest('#view'));
    if (!onCanvas || isOtherView() || state.editing || state.commenting || !state.selected || t.tagName === 'INPUT') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      startRename();
    } else if (event.key === 'Tab' && t === document.body) {
      // 図の中のボタンにフォーカスがあるときは、Tab でボタンを移動する（子は足さない）。
      event.preventDefault();
      addChild(state.selected);
    }
  }

  function setZoom(next) {
    state.zoom = Math.min(2, Math.max(0.4, next));
    draw();
  }

  // mindmap コマンドから開いたとき: ?file=<絶対パス> で、そのファイルを開く。?new=1 で、新規作成の画面を開く。
  function openFromUrl() {
    const params = new URLSearchParams(global.location.search);
    state.dir = params.get('dir');
    if (params.get('file')) {
      const path = params.get('file');
      startWatching((onChange, onErr) => M.watchPath(path, onChange, onErr));
    }
    if (params.has('new')) onNew();
  }

  function init() {
    if (typeof global.showOpenFilePicker !== 'function') {
      $('open').disabled = true;
      $('new').disabled = true;
      setStatus('This browser is not supported. Please use Chrome or Edge.');
      return;
    }
    $('open').addEventListener('click', onOpen);
    $('new').addEventListener('click', onNew);
    $('new-confirm').addEventListener('click', onNewConfirm);
    $('new-cancel').addEventListener('click', () => $('new-dialog').close());
    $('add-child').addEventListener('click', () => addChild(state.selected));
    $('add-topic').addEventListener('click', addTopic);
    $('chat-toggle').addEventListener('click', toggleChat);
    $('chat-close').addEventListener('click', toggleChat);
    for (const button of document.querySelectorAll('.chat-ai-btn')) {
      button.addEventListener('click', () => setChatAI(button.dataset.ai));
    }
    $('chat-form').addEventListener('submit', sendChat);
    $('chat-focus-clear').addEventListener('click', () => {
      chat.focus = null;
      renderChatFocus();
      redraw();
    });
    $('chat-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendChat(event);
      }
    });
    $('rename').addEventListener('click', startRename);
    settings = loadSettings();
    buildPaletteInputs();
    buildSwatches();
    applySettings();
    setFileControls(false);
    $('settings').addEventListener('click', openSettings);
    $('set-theme').addEventListener('change', (e) => changeSetting('theme', e.target.value));
    $('set-font').addEventListener('change', (e) => changeSetting('font', e.target.value));
    $('set-line').addEventListener('input', (e) => changeSetting('line', e.target.value));
    $('set-text').addEventListener('input', (e) => changeSetting('text', e.target.value));
    $('set-comment').addEventListener('input', (e) => changeSetting('comment', e.target.value));
    $('set-reset').addEventListener('click', resetSettings);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'system') applySettings();
    });
    $('zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1));
    $('zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));
    document.addEventListener('keydown', onKeyDown);
  }

  init();
  openFromUrl(); // 最後に（画面の準備が済んでから）
})(globalThis);

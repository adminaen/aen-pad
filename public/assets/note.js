(function () {
  const notePath = decodeURIComponent(location.pathname.replace(/^\/+/, '')) || 'inicio';
  document.title = notePath;

  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const previewToggle = document.getElementById('preview-toggle');
  const statusEl = document.getElementById('status');
  const zipLink = document.getElementById('zip-link');
  const historyLink = document.getElementById('history-link');
  const historyPanel = document.getElementById('history-panel');
  const historyList = document.getElementById('history-list');
  const historyClose = document.getElementById('history-close');
  const sidebar = document.getElementById('sidebar');
  const sidebarUp = document.getElementById('sidebar-up');
  const sidebarTitle = document.getElementById('sidebar-title');
  const sidebarList = document.getElementById('sidebar-list');

  zipLink.href = '/api/note/zip?path=' + encodeURIComponent(notePath);

  // Preview de Markdown: o texto salvo continua sendo sempre o markdown
  // puro (o textarea nunca muda de formato) — "visualizar" só troca o
  // que é mostrado, renderizando por cima. marked.js converte pra HTML,
  // DOMPurify sanitiza antes de injetar na página (proteção contra XSS
  // caso algum conteúdo colado tenha HTML malicioso disfarçado).
  marked.setOptions({ gfm: true, breaks: true });
  const SANITIZE_CONFIG = { ADD_TAGS: ['input'], ADD_ATTR: ['type', 'checked', 'disabled'] };
  let previewMode = false;

  function renderPreview() {
    preview.innerHTML = DOMPurify.sanitize(marked.parse(editor.value), SANITIZE_CONFIG);
  }

  /** Troca o texto do editor e, se o preview estiver aberto, re-renderiza. */
  function setEditorText(text) {
    editor.value = text;
    if (previewMode) renderPreview();
  }

  previewToggle.addEventListener('click', (event) => {
    event.preventDefault();
    previewMode = !previewMode;
    if (previewMode) {
      renderPreview();
      editor.hidden = true;
      preview.hidden = false;
      previewToggle.textContent = 'editar';
    } else {
      editor.hidden = false;
      preview.hidden = true;
      previewToggle.textContent = 'visualizar';
      editor.focus();
    }
  });

  function pathToHref(p) {
    return '/' + p.split('/').map(encodeURIComponent).join('/');
  }

  async function loadSidebar() {
    const hasParent = notePath.includes('/');
    if (hasParent) {
      const parentPath = notePath.slice(0, notePath.lastIndexOf('/'));
      sidebarUp.href = pathToHref(parentPath);
      sidebarUp.hidden = false;
    }

    let children = [];
    try {
      const res = await fetch('/api/note/children?path=' + encodeURIComponent(notePath));
      if (res.ok) {
        const data = await res.json();
        children = data.children || [];
      }
    } catch {
      // sem sidebar se a rede falhar — a nota principal continua funcionando
    }

    if (children.length > 0) {
      sidebarList.innerHTML = '';
      for (const child of children) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = pathToHref(child.path);
        a.textContent = '/' + child.path.slice(notePath.length + 1);
        li.appendChild(a);
        sidebarList.appendChild(li);
      }
      sidebarTitle.hidden = false;
      sidebarList.hidden = false;
    }

    sidebar.hidden = !(hasParent || children.length > 0);
  }

  loadSidebar();

  const SAVE_DELAY_MS = 600;
  let lastModified = 0;
  let dirty = false;
  let saveTimer = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function isConnected() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  /** Devolve false se não deu pra enviar (desconectado) — o texto continua "dirty". */
  function send(payload) {
    if (!isConnected()) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  // --- Conexão com reconexão automática ------------------------------
  // A conexão cai sozinha de vez em quando (proxy derrubando conexão
  // ociosa, notebook dormindo, troca de rede). Em vez de pedir pra
  // recarregar a página, reconecta com backoff (1s, 2s, 4s… até 30s) e,
  // se havia alterações não salvas, salva elas assim que voltar.
  const WS_URL =
    (location.protocol === 'https:' ? 'wss' : 'ws') +
    '://' + location.host + '/ws?path=' + encodeURIComponent(notePath);
  const RECONNECT_MIN_MS = 1000;
  const RECONNECT_MAX_MS = 30000;
  let ws = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let reconnectTimer = null;

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    clearTimeout(reconnectTimer);
    ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => {
      reconnectDelay = RECONNECT_MIN_MS;
      setStatus('conectado…');
    });
    ws.addEventListener('close', scheduleReconnect);
    ws.addEventListener('message', handleMessage);
  }

  function scheduleReconnect() {
    setStatus(dirty ? 'sem conexão — suas alterações serão salvas ao reconectar' : 'sem conexão — reconectando…');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  /** Aba voltou a ficar visível / rede voltou: tenta na hora, sem esperar o backoff. */
  function reconnectNow() {
    if (ws && ws.readyState !== WebSocket.CLOSED) return;
    reconnectDelay = RECONNECT_MIN_MS;
    connect();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow();
  });
  window.addEventListener('online', reconnectNow);

  function handleMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.type === 'init') {
      editor.disabled = false;
      if (dirty) {
        // Reconexão com alterações feitas enquanto estava offline: NÃO
        // sobrescreve o editor com o texto do servidor. Manda salvar com
        // o lastModified que este cliente conhecia — se ninguém mexeu na
        // nota nesse meio tempo, salva normal; se mexeu, o servidor
        // responde 'conflict' e cai no mesmo diálogo de sempre.
        setStatus('salvando…');
        send({ type: 'save', text: editor.value, lastModified });
      } else {
        setEditorText(msg.text);
        lastModified = msg.lastModified;
        setStatus('salvo');
      }
      return;
    }

    if (msg.type === 'update') {
      lastModified = msg.lastModified;
      if (!dirty) {
        setEditorText(msg.text);
        setStatus('atualizado em outra aba');
      }
      return;
    }

    if (msg.type === 'saved') {
      lastModified = msg.lastModified;
      dirty = false;
      setStatus('salvo');
      return;
    }

    if (msg.type === 'conflict') {
      const overwrite = confirm(
        'Essa nota foi alterada em outro lugar enquanto você editava. Sobrescrever com o seu texto atual?'
      );
      if (overwrite) {
        send({ type: 'save', text: editor.value, lastModified: msg.lastModified, force: true });
      } else {
        setEditorText(msg.text);
        lastModified = msg.lastModified;
        dirty = false;
        setStatus('salvo (versão do servidor)');
      }
    }
  }

  connect();

  // Sem isso, Tab move o foco pro próximo elemento focável da página
  // (o link do rodapé) em vez de inserir uma tabulação no texto —
  // comportamento padrão de <textarea>, mas ruim pra um editor de notas.
  editor.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('\t', start, end, 'end');
    editor.dispatchEvent(new Event('input'));
  });

  editor.addEventListener('input', () => {
    dirty = true;
    setStatus('editando…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (send({ type: 'save', text: editor.value, lastModified })) {
        setStatus('salvando…');
      } else {
        // Continua dirty: o handler de 'init' da reconexão salva isso.
        setStatus('sem conexão — suas alterações serão salvas ao reconectar');
      }
    }, SAVE_DELAY_MS);
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  historyLink.addEventListener('click', async (event) => {
    event.preventDefault();
    const res = await fetch('/api/note/history?path=' + encodeURIComponent(notePath));
    const data = await res.json();
    historyList.innerHTML = '';

    if (data.versions.length === 0) {
      historyList.textContent = 'sem histórico ainda.';
    }

    for (const version of data.versions) {
      const when = new Date(version.createdAt).toLocaleString('pt-BR');
      const previewText = version.text.slice(0, 80).replace(/\n/g, ' ') || '(vazio)';
      const btn = document.createElement('button');
      btn.textContent = when + ' — ' + previewText;
      btn.addEventListener('click', () => restoreVersion(version.id, when));
      historyList.appendChild(btn);
    }

    historyPanel.hidden = false;
  });

  async function restoreVersion(versionId, when) {
    if (!confirm('Restaurar a versão de ' + when + '? Isso vira a versão atual (uma nova entrada é salva no histórico).')) {
      return;
    }
    const res = await fetch('/api/note/restore?path=' + encodeURIComponent(notePath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId }),
    });
    const result = await res.json();
    if (!res.ok) {
      alert('Não foi possível restaurar essa versão.');
      return;
    }
    setEditorText(result.text);
    lastModified = result.lastModified;
    dirty = false;
    setStatus('restaurado');
    historyPanel.hidden = true;
  }

  historyClose.addEventListener('click', () => {
    historyPanel.hidden = true;
  });
})();

const { WebSocketServer } = require('ws');
const cookie = require('cookie');
const { URL } = require('url');

const { verifyToken, COOKIE_NAME } = require('./auth');
const { normalizePath, getNote, saveNote } = require('./notes');

/**
 * Sobe o WebSocket num upgrade handler dedicado (path fixo /ws), separado
 * do Express — o app.use(requireAuth) do Express não roda em eventos de
 * upgrade, então a mesma checagem de cookie é refeita aqui manualmente.
 */
// Ping periódico em toda conexão aberta. Dois motivos:
// 1. Manter a conexão "ativa" — proxies como o Cloudflare derrubam
//    WebSockets sem tráfego depois de ~100s, e uma nota aberta parada
//    não gera tráfego nenhum.
// 2. Detectar conexões mortas (notebook que dormiu, rede que caiu sem
//    fechar o socket direito) e tirá-las das salas — quem não respondeu
//    o ping anterior é encerrado.
// O navegador responde ao ping sozinho (pong), sem precisar de JS.
const HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 30000;

function setupWebSocket(httpServer, { path: wsPath = '/ws' } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // notePath -> Set<ws>

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== wsPath) return; // não é pra nós; deixa a conexão em paz

    const cookies = cookie.parse(req.headers.cookie || '');
    if (!verifyToken(cookies[COOKIE_NAME])) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const notePath = normalizePath(url.searchParams.get('path'));
    if (!notePath) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.notePath = notePath;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const notePath = ws.notePath;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    if (!rooms.has(notePath)) rooms.set(notePath, new Set());
    rooms.get(notePath).add(ws);

    const current = getNote(notePath);
    ws.send(JSON.stringify({ type: 'init', text: current.text, lastModified: current.lastModified }));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || msg.type !== 'save') return;

      const result = saveNote(notePath, String(msg.text ?? ''), msg.lastModified, !!msg.force);

      if (result.conflict) {
        ws.send(JSON.stringify({ type: 'conflict', text: result.text, lastModified: result.lastModified }));
        return;
      }

      ws.send(JSON.stringify({ type: 'saved', lastModified: result.lastModified }));
      for (const peer of rooms.get(notePath)) {
        if (peer !== ws && peer.readyState === peer.OPEN) {
          peer.send(JSON.stringify({ type: 'update', text: result.text, lastModified: result.lastModified }));
        }
      }
    });

    ws.on('close', () => {
      const set = rooms.get(notePath);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) rooms.delete(notePath);
    });
  });

  return wss;
}

module.exports = { setupWebSocket };

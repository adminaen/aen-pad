require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const archiver = require('archiver');

const notes = require('./src/notes');
const { requireAuth, checkPassword, issueSessionCookie, COOKIE_NAME } = require('./src/auth');
const { setupWebSocket } = require('./src/ws');

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// --- Rotas públicas (sem sessão) ---------------------------------------

// Favicon/ícones ficam públicos de propósito: o navegador pede /favicon.ico
// mesmo na tela de login, antes de qualquer sessão existir.
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});
app.get('/assets/favicon-32.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assets', 'favicon-32.png'));
});
app.get('/assets/apple-touch-icon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assets', 'apple-touch-icon.png'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (!checkPassword(req.body.password)) {
    return res.redirect(`/login?error=1&next=${encodeURIComponent(req.query.next || req.body.next || '/')}`);
  }
  issueSessionCookie(res);
  const next = req.body.next || req.query.next || '/';
  res.redirect(typeof next === 'string' && next.startsWith('/') ? next : '/');
});

// --- Tudo abaixo exige sessão -------------------------------------------

app.use(requireAuth);

app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// Cache longo e "imutável": seguro porque a URL de cada asset muda
// (?v=<hash>) sempre que o conteúdo muda — ver VERSIONED_ASSETS abaixo.
app.use(
  '/assets',
  express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1y', immutable: true })
);

app.get('/_notas', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notes-list.html'));
});

app.get('/api/_notas', (req, res) => {
  res.json({ notes: notes.listNotes() });
});

app.get('/api/note', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  if (!notePath) return res.status(400).json({ error: 'invalid-path' });
  res.json(notes.getNote(notePath));
});

app.post('/api/note', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  if (!notePath) return res.status(400).json({ error: 'invalid-path' });
  const { text, lastModified, force } = req.body;
  const result = notes.saveNote(
    notePath,
    String(text ?? ''),
    typeof lastModified === 'number' ? lastModified : 0,
    !!force
  );
  if (result.conflict) return res.status(409).json(result);
  res.json(result);
});

app.get('/api/note/children', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  if (!notePath) return res.status(400).json({ error: 'invalid-path' });
  res.json({ children: notes.getChildren(notePath) });
});

app.get('/api/note/history', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  if (!notePath) return res.status(400).json({ error: 'invalid-path' });
  res.json({ versions: notes.getHistory(notePath) });
});

app.post('/api/note/restore', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  const versionId = Number(req.body.versionId);
  if (!notePath || !versionId) return res.status(400).json({ error: 'invalid-request' });
  const result = notes.restoreVersion(notePath, versionId);
  if (!result) return res.status(404).json({ error: 'version-not-found' });
  res.json(result);
});

app.get('/api/note/zip', (req, res) => {
  const notePath = notes.normalizePath(req.query.path);
  if (!notePath) return res.status(400).json({ error: 'invalid-path' });
  const note = notes.getNote(notePath);
  const fileBase = (notePath.split('/').pop() || 'nota').replace(/[^a-zA-Z0-9_.-]/g, '_');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.zip"`);

  const archive = archiver('zip');
  archive.on('error', (err) => res.status(500).end(String(err)));
  archive.pipe(res);
  archive.append(note.text, { name: `${fileBase}.txt` });
  archive.finalize();
});

// Cache-busting: cada asset referenciado por note.html ganha
// ?v=<hash do próprio conteúdo> na URL, calculado uma vez na subida do
// servidor. Assim o navegador pode cachear "para sempre" (maxAge acima)
// com segurança — a URL só muda quando o conteúdo muda de verdade.
// Sem isso, depois de um deploy o navegador podia continuar servindo
// JS/CSS antigos do cache até um hard refresh manual.
const VERSIONED_ASSETS = ['assets/note.css', 'assets/vendor/marked.js', 'assets/vendor/purify.min.js', 'assets/note.js'];

function fileHash(relPath) {
  const buf = fs.readFileSync(path.join(__dirname, 'public', relPath));
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

let noteHtml = fs.readFileSync(path.join(__dirname, 'public', 'note.html'), 'utf8');
for (const asset of VERSIONED_ASSETS) {
  noteHtml = noteHtml.replaceAll(`"/${asset}"`, `"/${asset}?v=${fileHash(asset)}"`);
}

// Shell da nota: qualquer outro caminho é uma URL de nota — o path real
// é lido no front-end via location.pathname, não pelo roteamento aqui.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not-found' });
  res.type('html').send(noteHtml);
});

const server = http.createServer(app);
setupWebSocket(server, { path: '/ws' });

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`AEN Pad rodando em http://localhost:${port}`);
});

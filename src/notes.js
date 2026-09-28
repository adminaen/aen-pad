const db = require('./db');

const getStmt = db.prepare('SELECT text, last_modified AS lastModified FROM notes WHERE path = ?');
const insertStmt = db.prepare('INSERT INTO notes (path, text, last_modified) VALUES (?, ?, ?)');
const updateStmt = db.prepare('UPDATE notes SET text = ?, last_modified = ? WHERE path = ?');
const deleteStmt = db.prepare('DELETE FROM notes WHERE path = ?');
const insertVersionStmt = db.prepare('INSERT INTO note_versions (path, text, created_at) VALUES (?, ?, ?)');
const historyStmt = db.prepare(
  'SELECT id, text, created_at AS createdAt FROM note_versions WHERE path = ? ORDER BY created_at DESC LIMIT ?'
);
const versionByIdStmt = db.prepare('SELECT id, text FROM note_versions WHERE id = ? AND path = ?');
// Notas vazias nunca ficam salvas (nem criadas só por terem sido
// abertas, nem mantidas depois de esvaziadas) — então qualquer coisa
// que liste "todas as notas" já lê exclusivamente daqui, sem precisar
// filtrar texto vazio na aplicação.
const nonEmptyNotesStmt = db.prepare(
  'SELECT path, last_modified AS lastModified, length(text) AS size FROM notes WHERE length(text) > 0'
);

/**
 * Normaliza o path de uma URL em uma chave de nota estável:
 * remove barras nas pontas e segmentos "." / ".." (proteção contra
 * path traversal), mas preserva a hierarquia real (pai/filho).
 */
function normalizePath(rawPath) {
  const segments = String(rawPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  return segments.join('/');
}

/**
 * Não cria linha no banco só por ter sido lida — abrir uma URL sem
 * nunca escrever nada não deve deixar rastro em "todas as notas".
 * `lastModified: 0` é o sinal de "isso ainda não existe de verdade"
 * (sempre menor que qualquer timestamp real, então o primeiro save
 * nunca esbarra na checagem de conflito).
 */
function getNote(notePath) {
  const row = getStmt.get(notePath);
  if (row) return row;
  return { text: '', lastModified: 0 };
}

/**
 * Concorrência otimista, igual ao dontpad: se quem está salvando não
 * tinha a versão mais recente (lastModified enviado < lastModified no
 * banco) e não pediu "force", devolve o estado atual como conflito em
 * vez de sobrescrever.
 *
 * Salvar como vazio ("") apaga a linha em vez de gravar um texto vazio
 * — uma nota que você esvaziou não deve continuar poluindo a listagem
 * de "todas as notas". O histórico de versões anteriores não é tocado:
 * reabrir o mesmo path cria a nota de novo, e restaurar uma versão
 * antiga (não-vazia) do histórico funciona normalmente.
 */
function saveNote(notePath, text, clientLastModified, force) {
  const current = getStmt.get(notePath);
  const now = Date.now();

  if (current && !force && typeof clientLastModified === 'number' && clientLastModified < current.lastModified) {
    return { conflict: true, text: current.text, lastModified: current.lastModified };
  }

  if (text === '') {
    if (current) deleteStmt.run(notePath);
    return { conflict: false, text: '', lastModified: now, deleted: true };
  }

  if (current) {
    updateStmt.run(text, now, notePath);
  } else {
    insertStmt.run(notePath, text, now);
  }
  insertVersionStmt.run(notePath, text, now);

  return { conflict: false, text, lastModified: now };
}

function getHistory(notePath, limit = 50) {
  return historyStmt.all(notePath, limit);
}

function restoreVersion(notePath, versionId) {
  const version = versionByIdStmt.get(versionId, notePath);
  if (!version) return null;
  return saveNote(notePath, version.text, Date.now(), true);
}

function listNotes() {
  return nonEmptyNotesStmt.all().sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Sub-notas diretas de notePath (uma nota "pai/filho" é filha direta de
 * "pai", mas "pai/filho/neto" não é — aparece só quando você navega até
 * "pai/filho").
 */
function getChildren(notePath) {
  const prefix = notePath + '/';
  const parentDepth = notePath.split('/').length;
  return nonEmptyNotesStmt
    .all()
    .filter((n) => n.path.startsWith(prefix) && n.path.split('/').length === parentDepth + 1)
    .sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = { normalizePath, getNote, saveNote, getHistory, restoreVersion, listNotes, getChildren };

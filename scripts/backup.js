#!/usr/bin/env node
// Backup a quente do notes.db, seguro mesmo com o app rodando (WAL).
// Uso: node scripts/backup.js
// Variáveis: DATA_DIR (onde está o notes.db), BACKUP_DIR (onde salvar),
// BACKUP_KEEP_DAYS (retenção, padrão 14 dias).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

const dbPath = path.join(DATA_DIR, 'notes.db');

function pruneOldBackups() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    if (!file.startsWith('notes-') || !file.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, file);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      console.log(`Removido backup antigo: ${file}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`Banco não encontrado em ${dbPath} — nada pra fazer backup ainda.`);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = path.join(BACKUP_DIR, `notes-${stamp}.db`);

  // Aberto como readonly: este processo só lê, o app continua escrevendo
  // normalmente (WAL permite múltiplos leitores + um escritor ao mesmo tempo).
  const db = new Database(dbPath, { readonly: true });

  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }

  // O destino sai em modo WAL (herdado da fonte), o que deixa arquivos
  // -wal/-shm ao lado. Converte pra modo DELETE: um único arquivo .db
  // autocontido, mais fácil de copiar/restaurar.
  const destDb = new Database(destPath);
  destDb.pragma('journal_mode = DELETE');
  destDb.close();

  console.log(`Backup salvo em ${destPath}`);

  pruneOldBackups();
}

main().catch((err) => {
  console.error('Falha no backup:', err);
  process.exit(1);
});

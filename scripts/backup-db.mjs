import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const source = resolve(project, 'data/chat.sqlite');
if (!existsSync(source)) throw new Error('No existe la base de datos');
const directory = resolve(project, 'data/backups');
mkdirSync(directory, { recursive: true });
const file = resolve(directory, `chat-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
const db = new Database(source, { readonly: true });
try {
  await db.backup(file);
  const copy = new Database(file, { readonly: true });
  try { if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup no supera integrity_check'); }
  finally { copy.close(); }
  console.log('Backup SQLite consistente, integrity_check=ok:', file);
} finally { db.close(); }

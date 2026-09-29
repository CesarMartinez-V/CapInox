import type Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeProviderEvent } from './normalize.js';

const columnNames = (db: Database.Database, table: string) => new Set((db.pragma(`table_info(${table})`) as Array<{name:string}>).map(x=>x.name));
function addColumns(db: Database.Database, table: string, additions: Record<string,string>) {
  const names=columnNames(db,table);
  for (const [name, definition] of Object.entries(additions)) if (!names.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export async function migrate(db: Database.Database, path: string, root: string) {
  const exists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversations'").get());
  const old = exists && (!columnNames(db,'messages').has('sequence') || (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'").get() as {sql:string}).sql.includes('contact_id TEXT NOT NULL UNIQUE'));
  if (old && path !== ':memory:' && existsSync(path)) {
    const directory=resolve(root,'data/backups'); mkdirSync(directory,{recursive:true});
    const destination=resolve(directory,`chat-before-migration-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
    await db.backup(destination);
    const check=new (await import('better-sqlite3')).default(destination,{readonly:true});
    try { if(check.pragma('integrity_check',{simple:true})!=='ok') throw new Error('Backup SQLite inválido'); }
    finally { check.close(); }
    console.log('Database migration backup verified');
  }
  if (!exists) return;
  const current = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'").get() as {sql:string}).sql;
  if (current.includes('contact_id TEXT NOT NULL UNIQUE') || !current.includes("'CLOSING'")) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(()=>{
        db.exec(`CREATE TABLE conversations_migrated (
          id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES contacts(id),
          mode TEXT NOT NULL CHECK(mode IN ('MENU','AI','HUMAN_PENDING','HUMAN_ACTIVE','CLOSING','CLOSED')),
          intent TEXT, menu_state TEXT, assigned_agent_id TEXT REFERENCES agents(id),
          status TEXT NOT NULL DEFAULT 'open', unread_count INTEGER NOT NULL DEFAULT 0,
          last_message_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO conversations_migrated SELECT id,contact_id,mode,intent,menu_state,assigned_agent_id,status,unread_count,last_message_at,created_at,updated_at FROM conversations;
        DROP TABLE conversations;
        ALTER TABLE conversations_migrated RENAME TO conversations;`);
      })();
    } finally { db.pragma('foreign_keys = ON'); }
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Migration FK check failed');
  }
  addColumns(db,'conversations',{next_sequence:'INTEGER NOT NULL DEFAULT 0',invalid_menu_attempts:'INTEGER NOT NULL DEFAULT 0',closed_at:'TEXT',handoff_at:'TEXT',priority:"TEXT NOT NULL DEFAULT 'NORMAL'"});
  addColumns(db,'messages',{latitude:'REAL',longitude:'REAL',sequence:'INTEGER',received_at:'TEXT',client_message_id:'TEXT',reply_to_message_id:'TEXT',provider_event_id:'TEXT',provider_media_id:'TEXT',provider_url:'TEXT',storage_path:'TEXT',storage_status:'TEXT',duration:'REAL',caption:'TEXT',thumbnail_url:'TEXT'});
  addColumns(db,'agents',{name:'TEXT',password_hash:'TEXT',active:'INTEGER NOT NULL DEFAULT 1',status:"TEXT NOT NULL DEFAULT 'OFFLINE'",max_active_chats:'INTEGER NOT NULL DEFAULT 5',active_chat_count:'INTEGER NOT NULL DEFAULT 0',last_assigned_at:'TEXT',last_seen_at:'TEXT'});
  db.exec(`WITH ranked AS (SELECT id, ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY rowid) AS seq FROM messages)
    UPDATE messages SET sequence=(SELECT seq FROM ranked WHERE ranked.id=messages.id) WHERE sequence IS NULL;
    UPDATE messages SET received_at=created_at WHERE received_at IS NULL;
    UPDATE conversations SET next_sequence=COALESCE((SELECT MAX(sequence) FROM messages WHERE conversation_id=conversations.id),0);
    UPDATE conversations SET status='CLOSED',closed_at=COALESCE(closed_at,updated_at) WHERE mode='CLOSED';
    UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=agents.id AND mode IN ('HUMAN_ACTIVE','CLOSING'));
    CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_sequence ON messages(conversation_id,sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id ON messages(client_message_id) WHERE client_message_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_reply_once ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_event_id ON messages(provider_event_id) WHERE provider_event_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_contact ON conversations(contact_id) WHERE mode!='CLOSED';
    CREATE INDEX IF NOT EXISTS conversations_inbox ON conversations(mode,last_message_at DESC,id);
    CREATE INDEX IF NOT EXISTS conversations_handoff_fifo ON conversations(mode,handoff_at,id);
    CREATE INDEX IF NOT EXISTS conversations_agent ON conversations(assigned_agent_id,mode);
    CREATE INDEX IF NOT EXISTS messages_conversation_page ON messages(conversation_id,sequence DESC);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE REFERENCES messages(id), conversation_id TEXT NOT NULL REFERENCES conversations(id),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','DONE','FAILED')),
      attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER NOT NULL DEFAULT 0,
      lease_expires_at INTEGER, locked_at INTEGER, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,next_retry_at,created_at);
    CREATE INDEX IF NOT EXISTS jobs_conversation ON jobs(conversation_id,status);
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), provider_media_id TEXT, provider_url TEXT,
      mime_type TEXT, file_name TEXT, media_size INTEGER, duration REAL, caption TEXT, thumbnail_url TEXT,
      storage_status TEXT NOT NULL DEFAULT 'PENDING', storage_path TEXT, playable_path TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS media_message ON media_assets(message_id);
    CREATE TABLE IF NOT EXISTS metrics_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
  `);
  // Existing captured provider events contain message.media as [{url,type}]. Reclassify without discarding text/history.
  const oldMedia=db.prepare("SELECT id,raw_payload FROM messages WHERE direction='inbound' AND raw_payload IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_assets WHERE message_id=messages.id)").all() as Array<{id:string;raw_payload:string}>;
  db.transaction(()=>{
    for(const row of oldMedia){
      try{
        const n=normalizeProviderEvent(JSON.parse(row.raw_payload));
        if(!n.attachments.length)continue;
        db.prepare('UPDATE messages SET message_type=?,provider_url=?,storage_status=? WHERE id=?').run(n.messageType,n.media?.url||null,n.media?.url?'PENDING':'FAILED',row.id);
        for(const m of n.attachments)db.prepare('INSERT INTO media_assets(id,message_id,provider_url,mime_type,file_name,storage_status) VALUES (?,?,?,?,?,?)').run(randomUUID(),row.id,m.url,m.mimeType||null,m.fileName||null,m.url?'PENDING':'FAILED');
      }catch{/* Preserve malformed historical events unchanged. */}
    }
  })();
}

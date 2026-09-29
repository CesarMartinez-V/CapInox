import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, config } from './config.js';
import type { Normalized } from './normalize.js';
import { migrate } from './migrations.js';

mkdirSync(resolve(root, 'data'), { recursive: true });
const dbPath=process.env.DEMO_DB_PATH || resolve(root, 'data/chat.sqlite');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
 id TEXT PRIMARY KEY, provider_contact_id TEXT UNIQUE NOT NULL, phone TEXT, name TEXT,
 avatar_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES contacts(id),
  mode TEXT NOT NULL CHECK(mode IN ('MENU','AI','HUMAN_PENDING','HUMAN_ACTIVE','CLOSING','CLOSED')),
 intent TEXT, menu_state TEXT, assigned_agent_id TEXT REFERENCES agents(id),
 status TEXT NOT NULL DEFAULT 'open', unread_count INTEGER NOT NULL DEFAULT 0,
 last_message_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, provider_message_id TEXT UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id), direction TEXT NOT NULL, sender_type TEXT NOT NULL,
 route TEXT NOT NULL DEFAULT 'NONE', message_type TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
 media_url TEXT, mime_type TEXT, file_name TEXT, media_size INTEGER, delivery_status TEXT,
 provider_timestamp TEXT, raw_payload TEXT, processed_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(conversation_id, provider_timestamp, created_at);
CREATE TABLE IF NOT EXISTS conversation_events (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), event_type TEXT NOT NULL,
 data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), expires_at INTEGER NOT NULL
);
`);
await migrate(db,dbPath,root);
// The pre-RBAC administrator is the only account promoted automatically.
db.prepare("UPDATE agents SET role='SUPERADMIN' WHERE username=? AND role='AGENT'").run(config.ADMIN_USER);

export type Contact = { id: string; provider_contact_id: string; name: string | null; phone: string | null; created_at: string };
export type Conversation = { id: string; contact_id: string; mode: 'MENU'|'AI'|'HUMAN_PENDING'|'HUMAN_ACTIVE'|'CLOSING'|'CLOSED'; intent: string|null; assigned_agent_id: string|null; unread_count: number; next_sequence:number; invalid_menu_attempts:number; closed_at:string|null; last_message_at: string|null; updated_at: string; version:number; disposition:string|null; closed_by:string|null;close_note:string|null;sale_amount:number|null;sale_reference:string|null;follow_up_at:string|null;final_assignee_id:string|null;assignment_source:string|null };
export type Message = { id: string; provider_message_id: string|null; provider_event_id:string|null; sequence:number; client_message_id:string|null; reply_to_message_id:string|null; conversation_id: string; contact_id: string; direction: string; sender_type: string; route: string; message_type: string; text: string; media_url: string|null; mime_type: string|null; file_name: string|null; media_size: number|null; latitude: number|null; longitude: number|null; storage_status:string|null; delivery_status: string|null; provider_timestamp: string|null; processed_at: string|null; received_at:string|null; created_at: string };
export const getConversation = (id: string) => db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as Conversation | undefined;
export const getContact = (id: string) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id) as Contact | undefined;
export const getMessage = (id: string) => db.prepare('SELECT * FROM messages WHERE id=?').get(id) as Message | undefined;
export const event = (conversationId: string, type: string, data: object = {}) => {
  db.prepare('INSERT INTO conversation_events (id,conversation_id,event_type,data) VALUES (?,?,?,?)').run(randomUUID(), conversationId, type, JSON.stringify(data));
};
export function incrementCounter(name:string){db.prepare('INSERT INTO metrics_counters(name,value) VALUES (?,1) ON CONFLICT(name) DO UPDATE SET value=value+1').run(name);}
export function setMode(id: string, mode: Conversation['mode'], intent: string | null = null, agentId: string | null = null) {
  db.prepare("UPDATE conversations SET mode=?,intent=?,menu_state=NULL,assigned_agent_id=?,updated_at=datetime('now') WHERE id=?").run(mode, intent, agentId, id);
}

/** Durable, atomic inbound dedup. The returned message is processed once through the per-contact queue. */
export const persistInbound = db.transaction((n: Normalized, trace?:{correlationId:string;serverReceivedAt:string;validationCompletedAt:string;validationMs:number}) => {
  if (!n.messageId || !n.contactId) throw new Error('Inbound sin messageId o contact.id');
  if (db.prepare('SELECT 1 FROM messages WHERE provider_message_id=? OR provider_event_id=?').get(n.messageId,n.eventId || null)) return null;
  const dedupCompletedAt=new Date().toISOString();
  let contact = db.prepare('SELECT * FROM contacts WHERE provider_contact_id=?').get(n.contactId) as Contact | undefined;
  if (!contact) {
    const id = randomUUID();
    db.prepare('INSERT INTO contacts(id,provider_contact_id,phone,name) VALUES (?,?,?,?)').run(id, n.contactId, n.phone, n.customerName);
    contact = getContact(id)!;
  } else {
    db.prepare("UPDATE contacts SET phone=COALESCE(?,phone), name=COALESCE(?,name), updated_at=datetime('now') WHERE id=?").run(n.phone, n.customerName, contact.id);
  }
  let conversation = db.prepare('SELECT * FROM conversations WHERE contact_id=? ORDER BY rowid DESC LIMIT 1').get(contact.id) as Conversation | undefined;
  const reopened = conversation?.mode === 'CLOSED';
  const isNew = !conversation || reopened;
  if (isNew) {
    const id = randomUUID();
    db.prepare('INSERT INTO conversations (id,contact_id,mode) VALUES (?,?,?)').run(id, contact.id, 'MENU');
    conversation = getConversation(id)!;
    event(conversation.id,reopened?'reopened':'created');
  }
  if (!conversation) throw new Error('No se pudo crear conversación');
  const id = randomUUID();
  const sequence=conversation.next_sequence+1;
  const media=n.media;
  db.prepare(`INSERT INTO messages(id,provider_message_id,provider_event_id,conversation_id,contact_id,sequence,direction,sender_type,message_type,text,mime_type,file_name,media_size,latitude,longitude,provider_media_id,provider_url,storage_status,duration,caption,thumbnail_url,delivery_status,provider_timestamp,received_at,raw_payload)
    VALUES (?,?,?,?,?,?,'inbound','customer',?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`).run(
    id,n.messageId,n.eventId || null,conversation.id,contact.id,sequence,n.messageType,n.text,
    media?.mimeType || null,media?.fileName || null,media?.size ?? null,media?.latitude ?? null,media?.longitude ?? null,
    media?.providerMediaId || null,media?.url || null,media?.url?'PENDING':null,media?.duration ?? null,media?.caption || null,media?.thumbnail || null,
    n.timestamp,new Date().toISOString(),JSON.stringify(n.raw),
  );
  for (const item of n.attachments) db.prepare(`INSERT INTO media_assets(id,message_id,provider_media_id,provider_url,mime_type,file_name,media_size,duration,caption,thumbnail_url)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),id,item.providerMediaId||null,item.url||null,item.mimeType||null,item.fileName||null,item.size??null,item.duration??null,item.caption||null,item.thumbnail||null);
  db.prepare("UPDATE conversations SET next_sequence=?,unread_count=unread_count+1,last_message_at=?,updated_at=datetime('now') WHERE id=?").run(sequence,new Date().toISOString(),conversation.id);
  db.prepare('INSERT INTO jobs(id,message_id,conversation_id) VALUES (?,?,?)').run(randomUUID(),id,conversation.id);
  const jobEnqueuedAt=new Date().toISOString();
  const providerTime=n.raw&&typeof n.raw==='object'&&!Array.isArray(n.raw)&&typeof (n.raw as Record<string,unknown>).timestamp==='string'?(n.raw as Record<string,string>).timestamp:null;
  db.prepare(`INSERT INTO message_latency(message_id,correlation_id,direction,provider_event_timestamp,server_received_at,validation_completed_at,dedup_completed_at,job_enqueued_at,validation_ms)
    VALUES (?,?, 'inbound',?,?,?,?,?,?)`).run(id,trace?.correlationId||randomUUID(),providerTime,trace?.serverReceivedAt||new Date().toISOString(),trace?.validationCompletedAt||null,dedupCompletedAt,jobEnqueuedAt,trace?.validationMs??null);
  return { id, conversationId: conversation.id, isNew, reopened, correlationId:trace?.correlationId||null };
});

export const insertOutbound = db.transaction((conversation: Conversation, text: string, sender: 'bot'|'human', route: 'MENU'|'PRESET'|'AI'|'HUMAN', mediaUrl?: string, mimeType?: string, fileName?: string, replyTo?:string, clientId?:string, clientCreatedAt?:string, apiReceivedAt?:string) => {
  const previous=replyTo ? db.prepare('SELECT id FROM messages WHERE reply_to_message_id=?').get(replyTo) as {id:string}|undefined
    : clientId ? db.prepare('SELECT id FROM messages WHERE client_message_id=?').get(clientId) as {id:string}|undefined : undefined;
  if (previous) return { id:previous.id, created:false };
  const id=randomUUID(),sequence=conversation.next_sequence+1;
  db.prepare(`INSERT INTO messages(id,conversation_id,contact_id,sequence,client_message_id,reply_to_message_id,direction,sender_type,route,message_type,text,media_url,mime_type,file_name,delivery_status,processed_at,received_at)
    VALUES (?,?,?,?,?,?,'outbound',?,?,?,?,?,?,?,'pending',datetime('now'),?)`).run(
    id,conversation.id,conversation.contact_id,sequence,clientId||null,replyTo||null,sender,route,mediaUrl ? (mimeType?.startsWith('image/') ? 'image' : 'document') : 'text',text,mediaUrl || null,mimeType || null,fileName || null,new Date().toISOString(),
  );
  db.prepare("UPDATE conversations SET next_sequence=?,last_message_at=?,updated_at=datetime('now') WHERE id=?").run(sequence,new Date().toISOString(),conversation.id);
  db.prepare('INSERT INTO outbound_jobs(id,message_id) VALUES (?,?)').run(randomUUID(),id);
  const queuedAt=new Date().toISOString();
  db.prepare(`INSERT INTO message_latency(message_id,correlation_id,direction,client_created_at,api_received_at,job_enqueued_at,ai_reply_queued_at)
    VALUES (?,?,'outbound',?,?,?,?)`).run(id,clientId||randomUUID(),clientCreatedAt||null,apiReceivedAt||null,queuedAt,route==='AI'?queuedAt:null);
  return {id,created:true};
});

export const claimConversation = db.transaction((id: string, agentId: string) => {
  const current = getConversation(id);
  if (!current) return { ok: false, reason: 'No existe' };
  if (current.mode === 'HUMAN_ACTIVE') return { ok: false, reason: 'Esta conversación ya fue tomada por otro agente' };
  if (current.mode !== 'HUMAN_PENDING') return { ok: false, reason: 'La conversación no está esperando asesor' };
  const result = db.prepare("UPDATE conversations SET mode='HUMAN_ACTIVE',assigned_agent_id=?,unread_count=0,updated_at=datetime('now') WHERE id=? AND mode='HUMAN_PENDING'").run(agentId, id);
  if (!result.changes) return { ok: false, reason: 'Ya fue tomada por otro agente' };
  event(id, 'human_claimed', { agentId });
  db.prepare("UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE'),last_assigned_at=datetime('now') WHERE id=?").run(agentId,agentId);
  return { ok: true };
});

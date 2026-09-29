import { db } from './db.js';

export type RealtimeKind='conversation.changed'|'conversation.closed'|'message.created'|'message.updated'|'media.ready';
export function queueRealtime(kind:RealtimeKind,conversationId:string,messageId?:string){
  db.prepare('INSERT INTO realtime_events(kind,conversation_id,message_id) VALUES (?,?,?)').run(kind,conversationId,messageId||null);
}
export function readRealtime(afterId:number,limit=200){
  return db.prepare('SELECT id,kind,conversation_id,message_id FROM realtime_events WHERE id>? ORDER BY id ASC LIMIT ?').all(afterId,limit) as Array<{id:number;kind:RealtimeKind;conversation_id:string;message_id:string|null}>;
}
export function latestRealtimeId(){return (db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM realtime_events').get() as {n:number}).n;}

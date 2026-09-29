import { randomUUID } from 'node:crypto';
import { db } from './db.js';

type Component='MESSAGESYNC'|'WEBHOOK'|'WORKER'|'OUTBOUND_QUEUE'|'N8N'|'AI'|'DATABASE'|'SOCKET'|'MEDIA'|'AUTH'|'CAMPAIGN'|'SYSTEM';
type Severity='INFO'|'WARNING'|'ERROR'|'CRITICAL';
type Incident={code:string;component:Component;severity:Severity;title:string;userMessage:string;technicalMessage:string;conversationId?:string;messageId?:string;jobId?:string;httpStatus?:number;attemptCount?:number;correlationId?:string};
const redact=(s:string)=>s.replace(/(Bearer\s+|sk-|rk_|token[=:]\s*)[^\s,;]+/gi,'[redacted]').slice(0,1000);
export function recordIncident(input:Incident){
  const data={...input,technicalMessage:redact(input.technicalMessage),userMessage:redact(input.userMessage)};
  const key=input.jobId||input.messageId||input.conversationId||'';
  const previous=db.prepare("SELECT id FROM system_incidents WHERE status='OPEN' AND code=? AND COALESCE(job_id,message_id,conversation_id,'')=?").get(data.code,key) as {id:string}|undefined;
  if(previous){db.prepare('UPDATE system_incidents SET occurrence_count=occurrence_count+1,last_seen_at=datetime(\'now\'),technical_message=?,attempt_count=? WHERE id=?').run(data.technicalMessage,data.attemptCount??0,previous.id);return previous.id;}
  const id=randomUUID();
  db.prepare(`INSERT INTO system_incidents(id,code,severity,component,title,user_message,technical_message,correlation_id,conversation_id,message_id,job_id,http_status,attempt_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,data.code,data.severity,data.component,data.title,data.userMessage,data.technicalMessage,data.correlationId??null,data.conversationId??null,data.messageId??null,data.jobId??null,data.httpStatus??null,data.attemptCount??0);
  return id;
}
export function resolveIncident(id:string,actorId:string){return db.prepare("UPDATE system_incidents SET status='RESOLVED',resolved_at=datetime('now'),resolved_by=? WHERE id=? AND status='OPEN'").run(actorId,id).changes>0;}

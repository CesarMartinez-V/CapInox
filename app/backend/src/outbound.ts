import { randomUUID } from 'node:crypto';
import { db, getContact, getMessage, getConversation } from './db.js';
import { ProviderHttpError, sendWhatsapp } from './provider.js';
import { config } from './config.js';
import { recordIncident } from './incidents.js';
import { mark,measure,monotonic,elapsed } from './latency.js';
import { queueRealtime } from './realtime.js';
import { transitionConversation } from './state.js';

type Job={id:string;message_id:string;attempt_count:number};
const delays=[1000,5000,15000,60000];
const workerId=randomUUID();
let active=0,timer:ReturnType<typeof setInterval>|undefined;

const claim=db.transaction((messageId?:string):Job|undefined=>{
  const now=Date.now();
  const row=db.prepare(`SELECT id,message_id,attempt_count FROM outbound_jobs
    WHERE status='PENDING' AND available_at<=? AND (? IS NULL OR message_id=?)
    ORDER BY created_at,id LIMIT 1`).get(now,messageId??null,messageId??null) as Job|undefined;
  if(!row)return;
  const update=db.prepare("UPDATE outbound_jobs SET status='SENDING',attempt_count=attempt_count+1,locked_at=?,locked_by=?,updated_at=datetime('now') WHERE id=? AND status='PENDING'").run(now,workerId,row.id);
  if(!update.changes)return;
  db.prepare("UPDATE messages SET delivery_status='sending' WHERE id=?").run(row.message_id);
  const queued=db.prepare('SELECT job_enqueued_at FROM message_latency WHERE message_id=?').get(row.message_id) as {job_enqueued_at:string|null}|undefined;
  if(row.attempt_count===0&&queued?.job_enqueued_at){const wait=Date.now()-Date.parse(queued.job_enqueued_at);if(wait>=0)measure(row.message_id,'queue_wait_ms',wait);}
  return {...row,attempt_count:row.attempt_count+1};
});

async function processJob(job:Job){
  const msg=getMessage(job.message_id);
  const contact=msg&&getContact(msg.contact_id);
  if(!msg){db.prepare("UPDATE outbound_jobs SET status='FAILED',last_error='Message missing',locked_at=NULL,locked_by=NULL WHERE id=?").run(job.id);throw new Error('Outbound missing message');}
  let requestStarted:number|null=null;
  try{
    if(!contact?.provider_contact_id)throw new ProviderHttpError(400);
    mark(msg.id,'provider_request_started_at');requestStarted=monotonic();
    const response=await sendWhatsapp(contact.provider_contact_id,msg.text,msg.media_url?[msg.media_url]:[]);
    mark(msg.id,'provider_response_at');measure(msg.id,'provider_request_ms',elapsed(requestStarted));
    if(typeof response.id==='string')mark(msg.id,'provider_message_id_received_at');
    db.transaction(()=>{
      db.prepare("UPDATE outbound_jobs SET status='SENT',locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=datetime('now') WHERE id=? AND status='SENDING' AND locked_by=?").run(job.id,workerId);
      db.prepare("UPDATE messages SET delivery_status='sent' WHERE id=?").run(msg.id);
      queueRealtime('message.updated',msg.conversation_id,msg.id);
      if(msg.client_message_id===`close:${msg.conversation_id}`&&getConversation(msg.conversation_id)?.mode==='CLOSING'){
        const actor=db.prepare('SELECT closed_by,disposition FROM conversations WHERE id=?').get(msg.conversation_id) as {closed_by:string|null;disposition:string|null};
        const result=transitionConversation(msg.conversation_id,'CONFIRM_CLOSE');
        if(!result.ok)throw new Error(result.reason);
        db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,after_json) VALUES (?,?,?,?,?,?)').run(randomUUID(),actor.closed_by,'close','conversation',msg.conversation_id,JSON.stringify({mode:'CLOSED',disposition:actor.disposition}));
        queueRealtime('conversation.changed',msg.conversation_id);
        queueRealtime('conversation.closed',msg.conversation_id);
      }
    })();
    if(msg.client_message_id===`close:${msg.conversation_id}`)void import('./assignment.js').then(({assignPending})=>assignPending(true)).catch(()=>{});
  }catch(error){
    if(requestStarted!==null){measure(msg.id,'provider_request_ms',elapsed(requestStarted));if(error instanceof ProviderHttpError)mark(msg.id,'provider_response_at');}
    const definite=error instanceof ProviderHttpError;
    const retryable=definite&&(error.status===429||error.status>=500);
    const status=!definite?'UNKNOWN':retryable&&job.attempt_count<config.OUTBOUND_MAX_ATTEMPTS?'PENDING':'FAILED';
    const available=Date.now()+delays[Math.min(job.attempt_count-1,delays.length-1)];
    db.transaction(()=>{
      db.prepare("UPDATE outbound_jobs SET status=?,available_at=?,locked_at=NULL,locked_by=NULL,last_error=?,updated_at=datetime('now') WHERE id=? AND status='SENDING' AND locked_by=?")
        .run(status,available,error instanceof ProviderHttpError?`HTTP ${error.status}`:'Delivery not confirmed',job.id,workerId);
      db.prepare('UPDATE messages SET delivery_status=? WHERE id=?').run(status==='UNKNOWN'?'unknown':status==='FAILED'?'failed':'pending',msg.id);
      queueRealtime('message.updated',msg.conversation_id,msg.id);
      if(msg.client_message_id===`close:${msg.conversation_id}`&&status!=='PENDING'&&getConversation(msg.conversation_id)?.mode==='CLOSING'){
        transitionConversation(msg.conversation_id,'CLOSE_FAILED');
        queueRealtime('conversation.changed',msg.conversation_id);
      }
    })();
    if(status==='UNKNOWN'||status==='FAILED')recordIncident({code:status==='UNKNOWN'?'MSYNC_SEND_UNKNOWN':'MSYNC_SEND_FAILED',component:'OUTBOUND_QUEUE',severity:'ERROR',title:'Mensaje de WhatsApp sin entrega confirmada',userMessage:status==='UNKNOWN'?'No pudimos confirmar si el mensaje llegó. Se detuvo el reintento para evitar duplicados.':'No pudimos enviar un mensaje de WhatsApp. Revisa la incidencia antes de reintentar.',technicalMessage:error instanceof ProviderHttpError?`MessageSync HTTP ${error.status}; attempt ${job.attempt_count}/${config.OUTBOUND_MAX_ATTEMPTS}`:'Network outcome ambiguous; no automatic replay',conversationId:msg.conversation_id,messageId:msg.id,jobId:job.id,httpStatus:error instanceof ProviderHttpError?error.status:undefined,attemptCount:job.attempt_count});
    throw error;
  }
}

export async function dispatchOutbound(messageId:string){
  const job=claim(messageId);
  if(job){await processJob(job);return;}
  // Another worker may have claimed the message; never send a second copy.
  for(let i=0;i<100;i++){
    const row=db.prepare('SELECT status FROM outbound_jobs WHERE message_id=?').get(messageId) as {status:string}|undefined;
    if(row?.status==='SENT')return;
    if(!row||row.status==='FAILED'||row.status==='UNKNOWN'||row.status==='PENDING')throw new Error('Outbound delivery not confirmed');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Outbound delivery remains in progress');
}

export function wakeOutbound(){
  while(active<4){
    const job=claim();if(!job)break;
    active++;
    void processJob(job).catch(()=>{}).finally(()=>{active--;wakeOutbound();});
  }
}
export function startOutboundWorker(){
  // A process could have sent a request before crashing; lease expiry cannot prove non-delivery.
  db.prepare("UPDATE outbound_jobs SET status='UNKNOWN',last_error='Process stopped during send',locked_at=NULL,locked_by=NULL,updated_at=datetime('now') WHERE status='SENDING' AND locked_at<?").run(Date.now()-120000);
  db.prepare("UPDATE messages SET delivery_status='unknown' WHERE id IN (SELECT message_id FROM outbound_jobs WHERE status='UNKNOWN') AND delivery_status='sending'").run();
  const abandoned=db.prepare("SELECT m.conversation_id FROM outbound_jobs j JOIN messages m ON m.id=j.message_id WHERE j.status='UNKNOWN' AND m.client_message_id=('close:'||m.conversation_id)").all() as Array<{conversation_id:string}>;
  for(const item of abandoned)if(getConversation(item.conversation_id)?.mode==='CLOSING'){transitionConversation(item.conversation_id,'CLOSE_FAILED');queueRealtime('conversation.changed',item.conversation_id);}
  if(!timer){timer=setInterval(wakeOutbound,config.OUTBOUND_POLL_MS);timer.unref();}
  wakeOutbound();
}
export function stopOutboundWorker(){if(timer){clearInterval(timer);timer=undefined;}}
export function retryOutboundJob(id:string){
  const change=db.prepare("UPDATE outbound_jobs SET status='PENDING',available_at=0,last_error=NULL,updated_at=datetime('now') WHERE id=? AND status='FAILED'").run(id);
  if(change.changes){db.prepare("UPDATE messages SET delivery_status='pending' WHERE id=(SELECT message_id FROM outbound_jobs WHERE id=?)").run(id);wakeOutbound();}
  return Boolean(change.changes);
}

import { db, getMessage } from './db.js';
import { downloadMedia } from './media-service.js';
import { enqueue, routeMessage, sendReply, normalizeMenuOption, isHumanRequest, isMenuCommand } from './router.js';
import { assignPending } from './assignment.js';
import { config } from './config.js';
import { getConversation } from './db.js';
import { startOutboundWorker,stopOutboundWorker } from './outbound.js';
import { availableAgent } from './availability.js';
import { transitionConversation } from './state.js';
import { getMenu } from './config.js';
import { recordIncident } from './incidents.js';
import { mark,measure,monotonic,elapsed } from './latency.js';

type Job={id:string;message_id:string;conversation_id:string;priority:'HIGH'|'AI'};
let activeHigh=0,activeAi=0;
const claim=db.transaction(():Job|undefined=>{
  const now=Date.now();
  const candidates=db.prepare(`SELECT j.id,j.message_id,j.conversation_id,m.text,m.message_type,v.mode FROM jobs j JOIN messages m ON m.id=j.message_id JOIN conversations v ON v.id=j.conversation_id
    WHERE ((j.status='PENDING' AND j.next_retry_at<=?) OR (j.status='PROCESSING' AND j.lease_expires_at<?))
      AND NOT EXISTS (SELECT 1 FROM jobs prior JOIN messages earlier ON earlier.id=prior.message_id
        WHERE prior.conversation_id=j.conversation_id AND earlier.sequence<m.sequence AND prior.status IN ('PENDING','PROCESSING','FAILED'))
      AND NOT EXISTS (SELECT 1 FROM jobs running WHERE running.conversation_id=j.conversation_id AND running.id<>j.id
        AND running.status='PROCESSING' AND running.lease_expires_at>=?)
    ORDER BY CASE WHEN v.mode='AI' AND m.message_type='text' AND LOWER(TRIM(m.text)) NOT IN
      ('asesor','humano','persona','agente','menu','menú','inicio','0','1','2','3','4','quiero un asesor','quiero hablar con alguien','quiero hablar con una persona','pasame con asesor','pasame con un asesor')
      THEN 1 ELSE 0 END,m.rowid LIMIT 200`).all(now,now,now) as Array<Job&{text:string;message_type:string;mode:string}>;
  const isAi=(c:typeof candidates[number])=>c.mode==='AI'&&c.message_type==='text'&&!normalizeMenuOption(c.text)&&!isHumanRequest(c.text)&&!isMenuCommand(c.text);
  const found=(activeHigh<config.WORKER_HIGH_CONCURRENCY?candidates.find(c=>!isAi(c)):undefined)
    ||(activeAi<config.WORKER_AI_CONCURRENCY?candidates.find(isAi):undefined);
  if (!found) return undefined;
  const priority=isAi(found)?'AI':'HIGH';
  db.prepare("UPDATE jobs SET status='PROCESSING',attempt_count=attempt_count+1,locked_at=?,lease_expires_at=?,updated_at=datetime('now') WHERE id=?").run(now,now+120000,found.id);
  db.prepare('UPDATE message_latency SET queue_priority=? WHERE message_id=?').run(priority,found.message_id);
  mark(found.message_id,'worker_claimed_at');
  const queued=db.prepare('SELECT job_enqueued_at FROM message_latency WHERE message_id=?').get(found.message_id) as {job_enqueued_at:string|null}|undefined;
  if(queued?.job_enqueued_at){const wait=Date.now()-Date.parse(queued.job_enqueued_at);if(wait>=0)measure(found.message_id,'queue_wait_ms',wait);}
  return {id:found.id,message_id:found.message_id,conversation_id:found.conversation_id,priority};
});

let mediaActive=0,timer:ReturnType<typeof setInterval>|undefined,mediaTimer:ReturnType<typeof setInterval>|undefined;
export function workerAlive(){
  const row=db.prepare("SELECT last_seen_at FROM service_heartbeat WHERE service='worker'").get() as {last_seen_at:number}|undefined;
  return Boolean(row&&Date.now()-row.last_seen_at<5000);
}
function heartbeat(){db.prepare("INSERT INTO service_heartbeat(service,last_seen_at) VALUES ('worker',?) ON CONFLICT(service) DO UPDATE SET last_seen_at=excluded.last_seen_at").run(Date.now());}
export function wakeJobs() {
  while (activeHigh<config.WORKER_HIGH_CONCURRENCY||activeAi<config.WORKER_AI_CONCURRENCY) {
    const job=claim(); if (!job) break;
    if(job.priority==='AI')activeAi++;else activeHigh++;
    void enqueue(job.conversation_id,async()=>{
      const msg=getMessage(job.message_id);
      let combined:{text:string;ids:string[]}|undefined;
      if(msg?.message_type==='text'&&msg.sequence>1&&getConversation(job.conversation_id)?.mode==='AI'
        && !normalizeMenuOption(msg.text)&&!isMenuCommand(msg.text)&&!isHumanRequest(msg.text)) {
        const wait=Math.max(0,Date.parse(msg.received_at||msg.created_at)+config.AI_MESSAGE_DEBOUNCE_MS-Date.now());
        if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
        const next=db.prepare(`SELECT m.id,m.text,m.message_type,j.id AS job_id FROM messages m JOIN jobs j ON j.message_id=m.id
          WHERE m.conversation_id=? AND m.sequence>? AND m.direction='inbound' AND j.status='PENDING'
          ORDER BY m.sequence ASC LIMIT 10`).all(job.conversation_id,msg.sequence) as Array<{id:string;text:string;message_type:string;job_id:string}>;
        const ids:string[]=[],lines=[msg.text];
        for(const item of next){
          if(item.message_type!=='text'||normalizeMenuOption(item.text)||isMenuCommand(item.text)||isHumanRequest(item.text))break;
          ids.push(item.id);lines.push(item.text);
        }
        if(ids.length){
          const update=db.prepare("UPDATE jobs SET status='PROCESSING',attempt_count=attempt_count+1,locked_at=?,lease_expires_at=? WHERE message_id=? AND status='PENDING'");
          for(const id of ids)update.run(Date.now(),Date.now()+120000,id);
          combined={text:lines.join('\n'),ids};
        }
      }
       mark(job.message_id,'router_started_at');const routerStarted=monotonic();
       try{await routeMessage(job.message_id,false,combined);}
       catch(err){if(combined?.ids.length){const release=db.prepare("UPDATE jobs SET status='PENDING',lease_expires_at=NULL WHERE message_id=? AND status='PROCESSING'");for(const id of combined.ids)release.run(id);}throw err;}
       finally{mark(job.message_id,'router_completed_at');measure(job.message_id,'router_ms',elapsed(routerStarted));}
       if(combined?.ids.length){const done=db.prepare("UPDATE jobs SET status='DONE',lease_expires_at=NULL,error=NULL,completed_at=?,updated_at=datetime('now') WHERE message_id=? AND status='PROCESSING'");for(const id of combined.ids)done.run(Date.now(),id);}
       if (!getMessage(job.message_id)?.processed_at) throw new Error('Inbound unprocessed');
       db.prepare("UPDATE jobs SET status='DONE',lease_expires_at=NULL,error=NULL,completed_at=?,updated_at=datetime('now') WHERE id=?").run(Date.now(),job.id);
       await assignPending(true);
       const after=getConversation(job.conversation_id);
       if(config.HANDOFF_NO_AGENT_POLICY==='AI_FALLBACK'&&after?.mode==='HUMAN_PENDING'&&!after.assignment_source&&!availableAgent()){
         const switched=transitionConversation(job.conversation_id,'HUMAN_UNAVAILABLE');
         if(switched.ok){
           db.prepare('UPDATE conversations SET last_unavailable_at=? WHERE id=?').run(Date.now(),job.conversation_id);
           await sendReply(getConversation(job.conversation_id)!,getMenu().noAgent,'bot','PRESET');
         }
       }
    }).catch(err=>{
      if((db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as {status:string}|undefined)?.status==='DONE')return;
      const previous=db.prepare('SELECT attempt_count FROM jobs WHERE id=?').get(job.id) as {attempt_count:number};
      const isAI=Boolean(db.prepare("SELECT 1 FROM conversation_events WHERE conversation_id=? AND event_type='n8n_called' AND created_at>=(SELECT created_at FROM jobs WHERE id=?) LIMIT 1").get(job.conversation_id,job.id));
      const terminal=previous.attempt_count>=3 || isAI;
      const delay=[1000,5000,15000][Math.min(previous.attempt_count-1,2)];
      db.prepare("UPDATE jobs SET status=?,next_retry_at=?,lease_expires_at=NULL,error=?,updated_at=datetime('now') WHERE id=?").run(terminal?'FAILED':'PENDING',Date.now()+delay,err instanceof Error?err.message.slice(0,120):'unknown',job.id);
      if(terminal)recordIncident({code:'INBOUND_JOB_FAILED',component:'WORKER',severity:'ERROR',title:'Mensaje recibido pendiente de procesamiento',userMessage:'Un mensaje recibido no pudo procesarse automáticamente. El equipo puede revisarlo y reintentarlo.',technicalMessage:`Inbound job ${job.id} failed after ${previous.attempt_count} attempts`,conversationId:job.conversation_id,messageId:job.message_id,jobId:job.id,attemptCount:previous.attempt_count});
    }).finally(()=>{if(job.priority==='AI')activeAi--;else activeHigh--;wakeJobs();});
  }
}
function wakeMedia(){
  while(mediaActive<2){
    const row=db.prepare("SELECT message_id FROM media_assets WHERE storage_status='PENDING' ORDER BY rowid LIMIT 1").get() as {message_id:string}|undefined;
    if(!row)break;
    // Reserve all assets for this message before an asynchronous download starts.
    db.prepare("UPDATE media_assets SET storage_status='QUEUED' WHERE message_id=? AND storage_status='PENDING'").run(row.message_id);
    mediaActive++;
    void (async()=>{
      db.prepare("UPDATE media_assets SET storage_status='PENDING' WHERE message_id=? AND storage_status='QUEUED'").run(row.message_id);
      await downloadMedia(row.message_id);
    })().catch(()=>{}).finally(()=>{mediaActive--;wakeMedia();});
  }
}
export function startWorker(){
  startOutboundWorker();
  db.prepare("UPDATE media_assets SET storage_status='PENDING' WHERE storage_status='DOWNLOADING'").run();
  db.prepare("INSERT OR IGNORE INTO jobs(id,message_id,conversation_id) SELECT lower(hex(randomblob(16))),id,conversation_id FROM messages WHERE direction='inbound' AND processed_at IS NULL").run();
  heartbeat();
  db.prepare("UPDATE media_assets SET storage_status='PENDING' WHERE storage_status='QUEUED'").run();
  if (!timer) { timer=setInterval(()=>{heartbeat();wakeJobs();},config.INBOUND_POLL_MS); timer.unref(); }
  if(!mediaTimer){mediaTimer=setInterval(wakeMedia,config.MEDIA_POLL_MS);mediaTimer.unref();}
  wakeMedia();
  wakeJobs();
}
export function stopWorker(){stopOutboundWorker();if(timer){clearInterval(timer);timer=undefined;}if(mediaTimer){clearInterval(mediaTimer);mediaTimer=undefined;}db.prepare("DELETE FROM service_heartbeat WHERE service='worker'").run();}
export function retryJob(id:string){const change=db.prepare("UPDATE jobs SET status='PENDING',next_retry_at=0,error=NULL WHERE id=? AND status='FAILED'").run(id);if(change.changes)wakeJobs();return Boolean(change.changes);}

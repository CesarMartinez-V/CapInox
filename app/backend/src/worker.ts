import { db, getMessage } from './db.js';
import { downloadMedia } from './media-service.js';
import { enqueue, routeMessage, normalizeMenuOption, isHumanRequest, isMenuCommand } from './router.js';
import { assignPending } from './assignment.js';
import { config } from './config.js';
import { getConversation } from './db.js';

type Job={id:string;message_id:string;conversation_id:string};
const claim=db.transaction(():Job|undefined=>{
  const now=Date.now();
  const found=db.prepare(`SELECT j.id,j.message_id,j.conversation_id FROM jobs j JOIN messages m ON m.id=j.message_id
    WHERE ((j.status='PENDING' AND j.next_retry_at<=?) OR (j.status='PROCESSING' AND j.lease_expires_at<?))
      AND NOT EXISTS (SELECT 1 FROM jobs prior JOIN messages earlier ON earlier.id=prior.message_id
        WHERE prior.conversation_id=j.conversation_id AND earlier.sequence<m.sequence AND prior.status IN ('PENDING','PROCESSING','FAILED'))
      AND NOT EXISTS (SELECT 1 FROM jobs running WHERE running.conversation_id=j.conversation_id AND running.id<>j.id
        AND running.status='PROCESSING' AND running.lease_expires_at>=?)
    ORDER BY m.rowid LIMIT 1`).get(now,now,now) as Job|undefined;
  if (!found) return undefined;
  db.prepare("UPDATE jobs SET status='PROCESSING',attempt_count=attempt_count+1,locked_at=?,lease_expires_at=?,updated_at=datetime('now') WHERE id=?").run(now,now+120000,found.id);
  return found;
});

let active=0,timer:ReturnType<typeof setInterval>|undefined;
export function wakeJobs() {
  while (active<4) {
    const job=claim(); if (!job) break;
    active++;
    void enqueue(job.conversation_id,async()=>{
      const msg=getMessage(job.message_id);
      if (msg?.storage_status==='PENDING') await downloadMedia(msg.id);
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
      try{await routeMessage(job.message_id,false,combined);}
      catch(err){if(combined?.ids.length){const release=db.prepare("UPDATE jobs SET status='PENDING',lease_expires_at=NULL WHERE message_id=? AND status='PROCESSING'");for(const id of combined.ids)release.run(id);}throw err;}
      if(combined?.ids.length){const done=db.prepare("UPDATE jobs SET status='DONE',lease_expires_at=NULL,error=NULL,updated_at=datetime('now') WHERE message_id=? AND status='PROCESSING'");for(const id of combined.ids)done.run(id);}
      await assignPending();
      if (!getMessage(job.message_id)?.processed_at) throw new Error('Inbound unprocessed');
      db.prepare("UPDATE jobs SET status='DONE',lease_expires_at=NULL,error=NULL,updated_at=datetime('now') WHERE id=?").run(job.id);
    }).catch(err=>{
      const previous=db.prepare('SELECT attempt_count FROM jobs WHERE id=?').get(job.id) as {attempt_count:number};
      const isAI=Boolean(db.prepare("SELECT 1 FROM conversation_events WHERE conversation_id=? AND event_type='n8n_called' AND created_at>=(SELECT created_at FROM jobs WHERE id=?) LIMIT 1").get(job.conversation_id,job.id));
      const terminal=previous.attempt_count>=3 || isAI;
      const delay=[1000,5000,15000][Math.min(previous.attempt_count-1,2)];
      db.prepare("UPDATE jobs SET status=?,next_retry_at=?,lease_expires_at=NULL,error=?,updated_at=datetime('now') WHERE id=?").run(terminal?'FAILED':'PENDING',Date.now()+delay,err instanceof Error?err.message.slice(0,120):'unknown',job.id);
    }).finally(()=>{active--;wakeJobs();});
  }
}
export function startWorker(){
  db.prepare("UPDATE media_assets SET storage_status='PENDING' WHERE storage_status='DOWNLOADING'").run();
  db.prepare("INSERT OR IGNORE INTO jobs(id,message_id,conversation_id) SELECT lower(hex(randomblob(16))),id,conversation_id FROM messages WHERE direction='inbound' AND processed_at IS NULL").run();
  if (!timer) { timer=setInterval(wakeJobs,500); timer.unref(); }
  void (async()=>{
    for(;;){
      const old=db.prepare("SELECT DISTINCT message_id FROM media_assets WHERE storage_status='PENDING' LIMIT 25").all() as Array<{message_id:string}>;
      if(!old.length)break;
      for(const row of old)await downloadMedia(row.message_id);
    }
  })().catch(()=>{});
  wakeJobs();
}
export function stopWorker(){if(timer){clearInterval(timer);timer=undefined;}}
export function retryJob(id:string){const change=db.prepare("UPDATE jobs SET status='PENDING',next_retry_at=0,error=NULL WHERE id=? AND status='FAILED'").run(id);if(change.changes)wakeJobs();return Boolean(change.changes);}

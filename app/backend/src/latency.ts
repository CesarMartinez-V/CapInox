import { performance } from 'node:perf_hooks';
import { db } from './db.js';

export const nowUtc=()=>new Date().toISOString();
export const monotonic=()=>performance.now();
export const elapsed=(started:number)=>Math.max(0,Math.round((performance.now()-started)*1000)/1000);
const stages=new Set(['validation_completed_at','dedup_completed_at','db_persisted_at','job_enqueued_at','http_ack_at','worker_claimed_at','router_started_at','router_completed_at','socket_emitted_at','browser_received_at','api_received_at','provider_request_started_at','provider_response_at','provider_message_id_received_at','delivery_callback_at','read_callback_at','ai_requested_at','n8n_request_started_at','n8n_response_at','ai_reply_queued_at','media_started_at','media_completed_at']);
const durations=new Set(['validation_ms','db_persist_ms','http_ack_ms','queue_wait_ms','router_ms','socket_ack_ms','provider_request_ms','ai_request_ms','media_ms','api_accept_ms','client_to_api_ms','provider_llm_latency_ms']);
export function mark(messageId:string,stage:string,at=nowUtc()){
  if(!stages.has(stage))throw new Error('Unknown trace stage');
  db.prepare(`UPDATE message_latency SET ${stage}=COALESCE(${stage},?) WHERE message_id=?`).run(at,messageId);
}
export function measure(messageId:string,field:string,ms:number){
  if(!durations.has(field))throw new Error('Unknown trace duration');
  if(Number.isFinite(ms)&&ms>=0){
    db.prepare(`UPDATE message_latency SET ${field}=? WHERE message_id=?`).run(Math.round(ms*1000)/1000,messageId);
    if(field==='db_persist_ms'&&ms>100)console.warn(JSON.stringify({event:'slow_db_persist',duration_ms:Math.round(ms),message_id_prefix:messageId.slice(0,8)}));
  }
}
export function traceForMessage(messageId:string){return db.prepare('SELECT * FROM message_latency WHERE message_id=?').get(messageId) as Record<string,string|number|null>|undefined;}
const quantile=(sorted:number[],p:number)=>sorted.length?Math.round(sorted[Math.ceil(sorted.length*p)-1]*1000)/1000:null;
export function aggregateLatency(minutes:number){
  const since=new Date(Date.now()-minutes*60000).toISOString().replace('T',' ').slice(0,19);
  const rows=db.prepare(`SELECT t.*,m.route,m.message_type FROM message_latency t JOIN messages m ON m.id=t.message_id
    WHERE t.created_at>=? ORDER BY t.rowid DESC LIMIT 20000`).all(since) as Array<Record<string,unknown>>;
  const metrics=['provider_to_backend_ms','db_persist_ms','http_ack_ms','queue_wait_ms','high_queue_wait_ms','ai_queue_wait_ms','outbound_queue_wait_ms','media_queue_wait_ms','router_ms','socket_emit_after_commit_ms','socket_ack_ms','provider_request_ms','ai_request_ms','media_ms','api_accept_ms','client_to_api_ms'];
  const result:Record<string,{count:number;p50:number|null;p95:number|null;p99:number|null;negativeClockSamples?:number}>={};
  for(const key of metrics){
    let negativeClockSamples=0;
    const values=rows.map(row=>{
      if(key==='high_queue_wait_ms'||key==='ai_queue_wait_ms'){
        if(row.queue_priority!==(key==='high_queue_wait_ms'?'HIGH':'AI'))return null;
        return typeof row.queue_wait_ms==='number'?row.queue_wait_ms as number:null;
      }
      if(key==='outbound_queue_wait_ms')return row.direction==='outbound'&&typeof row.queue_wait_ms==='number'?row.queue_wait_ms as number:null;
      if(key==='media_queue_wait_ms'){
        const a=Date.parse(String(row.db_persisted_at||'')),b=Date.parse(String(row.media_started_at||''));
        return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,b-a):null;
      }
      if(key==='provider_to_backend_ms'){
        const a=Date.parse(String(row.provider_event_timestamp||'')),b=Date.parse(String(row.server_received_at||''));
        if(!Number.isFinite(a)||!Number.isFinite(b))return null;
        if(b<a){negativeClockSamples++;return null;}
        return b-a;
      }
      if(key==='socket_emit_after_commit_ms'){
        const a=Date.parse(String(row.db_persisted_at||'')),b=Date.parse(String(row.socket_emitted_at||''));
        return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,b-a):null;
      }
      return typeof row[key]==='number'?row[key] as number:null;
    }).filter((x):x is number=>x!==null&&Number.isFinite(x)).sort((a,b)=>a-b);
    result[key]={count:values.length,p50:quantile(values,.5),p95:quantile(values,.95),p99:quantile(values,.99)};
    if(key==='provider_to_backend_ms')result[key].negativeClockSamples=negativeClockSamples;
  }
  const byRoute=Object.fromEntries(['MENU','PRESET','AI','HUMAN'].map(route=>{
    const subset=rows.filter(x=>x.route===route);
    const router=subset.map(x=>x.router_ms).filter((n):n is number=>typeof n==='number').sort((a,b)=>a-b);
    const queue=subset.map(x=>x.queue_wait_ms).filter((n):n is number=>typeof n==='number').sort((a,b)=>a-b);
    return [route,{count:subset.length,routerMs:{p50:quantile(router,.5),p95:quantile(router,.95),p99:quantile(router,.99)},queueWaitMs:{p50:quantile(queue,.5),p95:quantile(queue,.95),p99:quantile(queue,.99)}}];
  }));
  return {windowMinutes:minutes,samples:rows.length,metrics:result,byRoute,notes:{providerTimestamp:'Webhook envelope timestamp; may represent MessageSync event time, not original WhatsApp send time. Clock skew is possible.',socketAck:'First authorized browser Socket ACK includes browser processing plus roundtrip, not one-way network latency.',missingStages:'null means not measured; DELIVERED/READ and provider LLM latency require verified callbacks/metadata.'}};
}

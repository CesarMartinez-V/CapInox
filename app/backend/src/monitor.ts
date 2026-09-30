import { db } from './db.js';
import { config } from './config.js';
import { workerAlive } from './worker.js';
import { expectedWebhookTarget, listSubscriptions } from './provider.js';
import { recordIncident,resolveRecoveredIncident } from './incidents.js';
import {aggregateLatency} from './latency.js';

let timer:ReturnType<typeof setInterval>|undefined;
let lastRealtimePrune=0;
export async function monitorSystem(){
  if(Date.now()-lastRealtimePrune>3600000){lastRealtimePrune=Date.now();db.prepare("DELETE FROM realtime_events WHERE created_at<datetime('now','-7 days')").run();}
  const latency=aggregateLatency(15);
  for(const [field,threshold,component] of [['socket_emit_after_commit_ms',2000,'SOCKET'],['high_queue_wait_ms',2000,'WORKER'],['outbound_queue_wait_ms',2000,'OUTBOUND_QUEUE'],['provider_request_ms',15000,'MESSAGESYNC'],['ai_request_ms',15000,'N8N']] as const){
    const metric=latency.metrics[field];
    if(metric&&metric.count>=5&&metric.p95!==null&&metric.p95>threshold)recordIncident({code:`PERFORMANCE_DEGRADATION_${field.toUpperCase()}`,component,severity:'WARNING',title:'Los mensajes están tardando más de lo normal',userMessage:'Los mensajes están tardando más de lo normal en procesarse.',technicalMessage:`${field} p95=${metric.p95}ms threshold=${threshold}ms samples=${metric.count}`});
  }
   if(!workerAlive())recordIncident({code:'WORKER_HEARTBEAT_MISSING',component:'WORKER',severity:'CRITICAL',title:'Procesamiento de mensajes detenido',userMessage:'Los mensajes recibidos están en cola mientras recuperamos el procesador.',technicalMessage:'Worker heartbeat missing for more than 5 seconds'});
   else resolveRecoveredIncident('WORKER_HEARTBEAT_MISSING');
  const oldest=db.prepare("SELECT created_at FROM outbound_jobs WHERE status='PENDING' ORDER BY created_at LIMIT 1").get() as {created_at:string}|undefined;
  if(oldest&&Date.now()-Date.parse(oldest.created_at.replace(' ','T')+'Z')>30000)recordIncident({code:'OUTBOUND_BACKLOG',component:'OUTBOUND_QUEUE',severity:'WARNING',title:'Mensajes salientes acumulados',userMessage:'Hay mensajes esperando entrega; el sistema continúa intentando enviarlos.',technicalMessage:'Oldest outbound PENDING job exceeds 30s'});
  const failed=(db.prepare("SELECT COUNT(*) AS n FROM outbound_jobs WHERE status IN ('FAILED','UNKNOWN')").get() as {n:number}).n;
  if(failed>=3)recordIncident({code:'OUTBOUND_FAILED_THRESHOLD',component:'OUTBOUND_QUEUE',severity:'ERROR',title:'Varios mensajes requieren revisión',userMessage:`${failed} mensajes salientes necesitan revisión antes de reintentar.`,technicalMessage:`Outbound FAILED/UNKNOWN count ${failed}`});
  const ai=db.prepare("SELECT event_type FROM conversation_events WHERE event_type IN ('ai_failed','ai_succeeded') ORDER BY rowid DESC LIMIT 5").all() as Array<{event_type:string}>;
  if(ai.length===5&&ai.every(x=>x.event_type==='ai_failed'))recordIncident({code:'AI_CONSECUTIVE_FAILURES',component:'AI',severity:'ERROR',title:'CAP IA no está respondiendo',userMessage:'Estamos ofreciendo respuestas preconfiguradas mientras se restablece la IA.',technicalMessage:'Last 5 AI executions failed'});
  const media=(db.prepare("SELECT COUNT(*) AS n FROM media_assets WHERE storage_status='FAILED'").get() as {n:number}).n;
  if(media>=3)recordIncident({code:'MEDIA_DOWNLOAD_FAILURES',component:'MEDIA',severity:'WARNING',title:'Algunos archivos no se pueden abrir',userMessage:'Hay archivos que necesitan una descarga nueva.',technicalMessage:`Failed media assets ${media}`});
  const reassignment=(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE needs_reassignment=1 AND mode='HUMAN_ACTIVE'").get() as {n:number}).n;
   if(reassignment)recordIncident({code:'HUMAN_CHATS_NEED_REASSIGNMENT',component:'SYSTEM',severity:'CRITICAL',title:'Chats humanos sin agente conectado',userMessage:`${reassignment} conversaciones humanas necesitan reasignación; no se enviaron a IA.`,technicalMessage:`Human active conversations flagged NEEDS_REASSIGNMENT: ${reassignment}`});
   else resolveRecoveredIncident('HUMAN_CHATS_NEED_REASSIGNMENT');
  try{
    const list=await listSubscriptions();
    let expected='';try{expected=expectedWebhookTarget();}catch{}
    const own=list.filter(s=>s.description==='web-demo-human-console');
     if(!expected||own.length!==1||own[0].targetUrl!==expected)recordIncident({code:'MSYNC_WEBHOOK_MISMATCH',component:'WEBHOOK',severity:'CRITICAL',title:'WhatsApp apunta a otra dirección',userMessage:'Los mensajes pueden no llegar a CAP Inbox. Configura el webhook público estable.',technicalMessage:'MessageSync subscription target differs from PUBLIC_WEBHOOK_URL expected target'});
     else resolveRecoveredIncident('MSYNC_WEBHOOK_MISMATCH');
     resolveRecoveredIncident('MSYNC_API_UNREACHABLE');
  }catch{
    recordIncident({code:'MSYNC_API_UNREACHABLE',component:'MESSAGESYNC',severity:'ERROR',title:'Sin conexión con MessageSync',userMessage:'No podemos confirmar el estado del proveedor de WhatsApp.',technicalMessage:'MessageSync subscription API unreachable'});
  }
}
export function startMonitor(){if(timer)return;timer=setInterval(()=>{void monitorSystem().catch(()=>{});},60000);timer.unref();}
export function stopMonitor(){if(timer){clearInterval(timer);timer=undefined;}}

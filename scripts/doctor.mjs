import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, root } from '../app/backend/src/config.ts';
import { expectedWebhookTarget, listSubscriptions, publicWebhookBase } from '../app/backend/src/provider.ts';

const checks=[];
function report(name,ok,detail=''){checks.push({name,status:ok?'PASS':'FAIL',detail});}
async function http(url){try{return await fetch(url,{signal:AbortSignal.timeout(5000)});}catch{return null;}}
report('Node >= 22',Number(process.versions.node.split('.')[0])>=22,`v${process.versions.node}`);
report('Dependencies',existsSync(resolve(root,'node_modules/tsx'))&&existsSync(resolve(root,'node_modules/vite')));
const backend=await http(`http://127.0.0.1:${config.PORT}/health/live`);
report('Backend',backend?.ok===true);
const ready=await http(`http://127.0.0.1:${config.PORT}/health/ready`);
const readiness=await ready?.json().catch(()=>null);
report('Worker',readiness?.worker===true);
report('Configuration',Boolean(config.GHL_LOCATION_ID&&config.MESSAGESYNC_API_KEY&&config.N8N_AI_WEBHOOK_URL&&config.WEBHOOK_INGRESS_SECRET.length>=32));
const frontend=await http('http://127.0.0.1:5174');report('Frontend CAP (5174)',frontend?.ok===true);
const socket=await http(`http://127.0.0.1:${config.PORT}/socket.io/?EIO=4&transport=polling`);
report('Socket.IO transport',socket?.ok===true);
try{
  const db=new Database(resolve(root,'data/chat.sqlite'),{readonly:true,fileMustExist:true});
  try{
    report('SQLite integrity',db.pragma('integrity_check',{simple:true})==='ok');
    const counts=db.prepare("SELECT SUM(status='FAILED') AS failed,SUM(status='PENDING') AS pending,MIN(CASE WHEN status='PENDING' THEN created_at END) AS oldest FROM jobs").get();
    report('Inbound failed jobs',!counts.failed,`${counts.failed||0} failed; ${counts.pending||0} pending`);
    const inboundAge=counts.oldest?Math.round((Date.now()-Date.parse(counts.oldest.replace(' ','T')+'Z'))/1000):0;
    report('Inbound backlog age',inboundAge<30,`${inboundAge}s oldest pending`);
    const outbound=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_jobs'").get();
    report('Outbound queue schema',Boolean(outbound));
    if(outbound){const q=db.prepare("SELECT SUM(status IN ('FAILED','UNKNOWN')) AS failed,SUM(status='PENDING') AS pending,MIN(CASE WHEN status='PENDING' THEN created_at END) AS oldest FROM outbound_jobs").get();report('Outbound queue',!q.failed,`${q.failed||0} failed/unknown; ${q.pending||0} pending`);const age=q.oldest?Math.round((Date.now()-Date.parse(q.oldest.replace(' ','T')+'Z'))/1000):0;report('Outbound backlog age',age<30,`${age}s oldest pending`);}
    const ai=db.prepare("SELECT MAX(created_at) AS last_success FROM conversation_events WHERE event_type='ai_succeeded'").get();
    report('AI Engine recent success',Boolean(ai.last_success&&Date.now()-Date.parse(ai.last_success.replace(' ','T')+'Z')<3600000),ai.last_success?`last success: ${ai.last_success} UTC`:'no successful execution recorded');
  }finally{db.close();}
}catch{report('SQLite',false);}
let publicUrl='';let target='';
try{publicUrl=publicWebhookBase();target=expectedWebhookTarget(publicUrl);report('PUBLIC_WEBHOOK_URL stable',true);}
catch{report('PUBLIC_WEBHOOK_URL stable',false,'Stable public webhook tunnel is not configured.');}
const publicRes=publicUrl?await http(`${publicUrl}/health/live`):null;
report('Named tunnel / public URL',publicRes?.ok===true,publicUrl?'public health probe':'missing stable hostname');
try{
  const list=await listSubscriptions();report('MessageSync API',true);
  const own=list.filter(s=>s.description==='web-demo-human-console');
  const exact=Boolean(target&&own.length===1&&own[0].targetUrl===target);
  report('MessageSync webhook target',exact,exact?'exact target match': 'MessageSync is sending events to a different webhook URL.');
  report('Other subscriptions',list.length===own.length,`${list.length-own.length} external subscriptions; review duplicate triggers`);
}catch{report('MessageSync API',false);report('MessageSync webhook target',false,'MessageSync subscription could not be verified.');}
const n8n=config.N8N_AI_WEBHOOK_URL?await http(new URL('/',config.N8N_AI_WEBHOOK_URL)):null;
report('n8n transport',n8n?.ok===true,'reachable host is not proof of AI execution');
const result={result:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',timestamp:new Date().toISOString(),checks};
if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
else{for(const c of checks)console.log(`${c.status} ${c.name}${c.detail?` — ${c.detail}`:''}`);console.log(`Result: ${result.result} (${checks.filter(c=>c.status==='FAIL').length} failures). No messages sent.`);}
if(result.result!=='PASS')process.exitCode=1;

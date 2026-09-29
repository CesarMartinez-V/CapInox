import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

// Isolated DB, mocked MessageSync and n8n. Never use real provider credentials or live DB.
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';
const {config}=await import('../app/backend/src/config.ts');
const {db}=await import('../app/backend/src/db.ts');
const {httpServer}=await import('../app/backend/src/server.ts');
const {startWorker,stopWorker}=await import('../app/backend/src/worker.ts');
config.GHL_LOCATION_ID='fixture-location';config.MESSAGESYNC_API_KEY='fixture-key';
config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';config.AI_MESSAGE_DEBOUNCE_MS=0;
config.HANDOFF_NO_AGENT_POLICY='AI_FALLBACK';
const realFetch=globalThis.fetch;let aiCalls=0,providerSends=0;
globalThis.fetch=async(url)=>{
  if(String(url).startsWith('https://api.messagesync.ai/')){providerSends++;return Response.json({id:randomUUID()});}
  if(String(url).startsWith('https://ai.fixture.test/')){aiCalls++;return Response.json({success:true,route:'AI',reply:'Respuesta IA mock'});}
  return realFetch(url);
};
const count=(query)=>db.prepare(query).get().n;
const pct=(items,p)=>items.length?Math.round(items.sort((a,b)=>a-b)[Math.ceil(items.length*p)-1]*1000)/1000:null;
const agents=Array.from({length:20},(_,i)=>`fixture-agent-${i}`);
const allHuman=process.argv.includes('--all-human'),capacity=allHuman?30:5;
for(const id of agents)db.prepare("INSERT INTO agents(id,username,active,status,manual_status,connection_count,max_active_chats,last_seen_at) VALUES (?,?,1,'ONLINE','ONLINE',1,?,?)").run(id,id,capacity,new Date().toISOString());
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const address=httpServer.address();const endpoint=`http://127.0.0.1:${address.port}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`;
startWorker();
let pendingMax=0;const monitor=setInterval(()=>{pendingMax=Math.max(pendingMax,count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('PENDING','PROCESSING')"));},50);
let accepted=0,errors=0,inFlight=0;const waiters=[];
async function throttle(){if(inFlight>=64)await new Promise(resolve=>waiters.push(resolve));inFlight++;return()=>{inFlight--;waiters.shift()?.();};}
async function batch(contacts,text,measure=false){
  const ack=[];
  await Promise.all(contacts.map(async contact=>{
    const event={event:'whatsapp.inbound',eventId:randomUUID(),locationId:config.GHL_LOCATION_ID,payload:{messageId:randomUUID(),contact:{id:contact},message:{text}}};
    const release=await throttle(),begin=performance.now();
    try{const r=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});if(r.status!==202)errors++;else accepted++;if(measure)ack.push(performance.now()-begin);}catch{errors++;}finally{release();}
  }));
  return ack;
}
async function drained(){const expected=accepted;for(let i=0;i<1200;i++){
  if(count("SELECT COUNT(*) AS n FROM jobs WHERE status='DONE'")>=expected)return;
  await new Promise(resolve=>setTimeout(resolve,100));
}throw new Error(`Worker backlog did not drain: expected=${expected} done=${count("SELECT COUNT(*) AS n FROM jobs WHERE status='DONE'")} failed=${count("SELECT COUNT(*) AS n FROM jobs WHERE status='FAILED'")}`);}
try{
  const contacts=Array.from({length:600},()=>randomUUID());
  const started=performance.now(),ack=await batch(contacts,'Hola',true);await drained();
  if(allHuman){
    await batch(contacts,'4');await drained();
    await batch(contacts,'Necesito atención humana');await drained();
  }else{
    await batch(contacts.slice(0,200),'1');await drained();
    await batch(contacts.slice(0,200),'Bujías para Hilux 2019');await drained();
    await batch(contacts.slice(200,400),'4');await drained();
    await batch(contacts.slice(200,400),'Necesito atención');await drained();
    await batch(contacts.slice(400),'9');await drained();
    await batch(contacts.slice(400),'9');await drained();
  }
  const active=count("SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_ACTIVE'");
  const pending=count("SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_PENDING'");
  const fallback=count("SELECT COUNT(*) AS n FROM conversation_events WHERE event_type='handoff_unavailable_ai_fallback'");
  const inbounds=count("SELECT COUNT(*) AS n FROM messages WHERE direction='inbound'");
  const wrong=count("SELECT COUNT(*) AS n FROM conversations WHERE assigned_agent_id IS NOT NULL AND assigned_agent_id NOT LIKE 'fixture-agent-%'");
  const collisions=count('SELECT COUNT(*) AS n FROM (SELECT conversation_id,sequence,COUNT(*) c FROM messages GROUP BY conversation_id,sequence HAVING c>1)');
  const mixed=count('SELECT COUNT(*) AS n FROM (SELECT v.id,COUNT(DISTINCT m.contact_id) AS n FROM conversations v JOIN messages m ON m.conversation_id=v.id GROUP BY v.id HAVING n>1)');
  const outstanding=count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('PENDING','PROCESSING','FAILED')");
  const outboundOutstanding=count("SELECT COUNT(*) AS n FROM outbound_jobs WHERE status IN ('PENDING','SENDING','FAILED','UNKNOWN')");
  const loads=db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_ACTIVE' GROUP BY assigned_agent_id").all().map(x=>x.n);
  const workerLatency=db.prepare("SELECT j.completed_at,m.received_at FROM jobs j JOIN messages m ON m.id=j.message_id WHERE j.status='DONE' AND j.completed_at IS NOT NULL").all().map(row=>Math.max(0,row.completed_at-Date.parse(row.received_at)));
  const internal={};
  for(const [name,direction,column,priority] of [['inboundCommit','inbound','db_persist_ms'],['backendHttpAck','inbound','http_ack_ms'],['highQueueWait','inbound','queue_wait_ms','HIGH'],['normalAiQueueWait','inbound','queue_wait_ms','AI'],['routerProcessing','inbound','router_ms'],['outboundQueueWait','outbound','queue_wait_ms'],['providerRequest','outbound','provider_request_ms'],['aiRequest','inbound','ai_request_ms'],['socketAck','inbound','socket_ack_ms']]){
    const values=db.prepare(`SELECT ${column} AS ms FROM message_latency WHERE direction=? AND ${column} IS NOT NULL ${priority?'AND queue_priority=?':''}`).all(...(priority?[direction,priority]:[direction])).map(row=>row.ms);
    internal[name]={count:values.length,p50Ms:pct(values,.5),p95Ms:pct(values,.95),p99Ms:pct(values,.99)};
  }
  const result={scenario:allHuman?'600_human_active':'600_mixed',contacts:contacts.length,events:accepted,errors,lost:accepted-inbounds,active,pending,fallback,aiCalls,providerSends,wrongAssignments:wrong,sequenceCollisions:collisions,mixedContacts:mixed,inboundBacklog:outstanding,outboundBacklog:outboundOutstanding,peakInboundQueue:pendingMax,agentLoads:loads,ackP50Ms:pct(ack,.5),ackP95Ms:pct(ack,.95),ackP99Ms:pct(ack,.99),workerP50Ms:pct(workerLatency,.5),workerP95Ms:pct(workerLatency,.95),workerP99Ms:pct(workerLatency,.99),internal,elapsedMs:Math.round(performance.now()-started),maxTransportInFlight:64,unauthorizedSocketLeaks:'not_measured_in_this_scenario'};
  result.routeProcessing=Object.fromEntries(['MENU','PRESET','AI','HUMAN'].map(route=>{const values=db.prepare('SELECT t.router_ms AS ms FROM message_latency t JOIN messages m ON m.id=t.message_id WHERE t.direction=\'inbound\' AND m.route=? AND t.router_ms IS NOT NULL').all(route).map(x=>x.ms);return [route,{count:values.length,p50Ms:pct(values,.5),p95Ms:pct(values,.95),p99Ms:pct(values,.99)}];}));
  console.log(JSON.stringify(result));
  if(errors||result.lost||pending||active!==(allHuman?600:100)||fallback!==(allHuman?0:100)||wrong||collisions||mixed||outstanding||outboundOutstanding||aiCalls!==(allHuman?0:300)||loads.length!==20||loads.some(x=>x!==capacity))throw new Error('600-chat invariant failure');
}finally{clearInterval(monitor);stopWorker();globalThis.fetch=realFetch;await new Promise(resolve=>httpServer.close(resolve));}

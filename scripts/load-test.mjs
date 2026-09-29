import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Entirely isolated from the live SQLite file and external provider/AI services.
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';
const { config }=await import('../app/backend/src/config.ts');
const { db }=await import('../app/backend/src/db.ts');
const { httpServer }=await import('../app/backend/src/server.ts');
config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';
const realFetch=globalThis.fetch;
let providerSends=0,aiCalls=0;
globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://api.messagesync.ai/')){providerSends++;return Response.json({id:randomUUID()});}
  if(String(url).startsWith('https://ai.fixture.test/')){aiCalls++;throw new Error('Load test routed unexpectedly to AI');}
  return realFetch(url,init);
};
const percentile=(sorted,p)=>Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]||0);
const done=async(expected)=>{
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const count=db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='DONE'").get().n;
    if(count>=expected)return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Durable worker timed out');
};
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',2048,resolve));
const addr=httpServer.address();const endpoint=`http://127.0.0.1:${addr.port}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`;
let accepted=0;
const maxTransportInFlight=64;let inFlight=0;const waiting=[];
async function acquire(){if(inFlight>=maxTransportInFlight)await new Promise(resolve=>waiting.push(resolve));inFlight++;return()=>{inFlight--;waiting.shift()?.();};}
async function scenario(name,entries){
  const samples=[],errors=[];const baseline=process.memoryUsage().rss,started=performance.now();
  const sends=entries.map(async({contact,text},i)=>{
    const body={event:'whatsapp.inbound',eventId:randomUUID(),locationId:'fixture-location',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:contact},message:{text}}};
    const start=performance.now();
    const release=await acquire();
    try{
      const res=await realFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      samples.push(performance.now()-start);
      if(res.status!==202)errors.push(res.status);else accepted++;
    }catch(e){errors.push(e instanceof Error?`${e.name}:${e.cause?.code||'unknown'}`:'unknown');}
    finally{release();}
  });
  await Promise.all(sends);
  if(!errors.length)await done(accepted);
  const sorted=samples.sort((a,b)=>a-b),memoryDelta=Math.round((process.memoryUsage().rss-baseline)/1024/1024);
  const errorCounts=Object.fromEntries([...new Set(errors)].map(value=>[String(value),errors.filter(x=>x===value).length]));
  const elapsed=performance.now()-started;
  console.log(JSON.stringify({scenario:name,logical_requests:entries.length,max_transport_inflight:maxTransportInFlight,errors:errors.length,error_types:errorCounts,throughput_per_sec:Math.round(entries.length*1000/elapsed),p50_ms:percentile(sorted,.5),p95_ms:percentile(sorted,.95),p99_ms:percentile(sorted,.99),rss_delta_mb:memoryDelta,ai_calls:aiCalls}));
  if(errors.length)throw new Error(`${name} produced ${errors.length} HTTP errors`);
}
try{
  for(const n of [100,500,1000])if(!process.argv.includes('--only=500')||n===500)await scenario(`${n}_contacts`,Array.from({length:n},()=>({contact:randomUUID(),text:'Hola'})));
  if(process.argv.includes('--only=500'))process.exitCode=0;
  else {
  const same=randomUUID();await scenario('same_contact_100',Array.from({length:100},(_,i)=>({contact:same,text:i?'9':'Hola'})));
  await scenario('different_contacts_1000',Array.from({length:1000},()=>({contact:randomUUID(),text:'Hola'})));
  }
  const rows=db.prepare('SELECT conversation_id,COUNT(*) AS n,MIN(sequence) AS min,MAX(sequence) AS max FROM messages GROUP BY conversation_id HAVING n<>max OR min<>1').all();
  const dup=db.prepare('SELECT COUNT(*) n FROM (SELECT conversation_id,sequence,COUNT(*) c FROM messages GROUP BY conversation_id,sequence HAVING c>1)').get().n;
  console.log(JSON.stringify({accepted,provider_sends:providerSends,ai_calls:aiCalls,sequence_gaps:rows.length,duplicate_sequence:dup,failed_jobs:db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='FAILED'").get().n,peak_rss_mb:Math.round(process.memoryUsage().rss/1024/1024)}));
  if(aiCalls||rows.length||dup)throw new Error('Load invariants failed');
}finally{globalThis.fetch=realFetch;await new Promise(resolve=>httpServer.close(resolve));}

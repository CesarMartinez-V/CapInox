import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {io as client} from 'socket.io-client';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';process.env.CAP_WORKER_EXTERNAL='true';
const {db}=await import('../app/backend/src/db.ts');
const {httpServer,stopRealtimeRelay}=await import('../app/backend/src/server.ts');
const actor=randomUUID(),token=randomUUID();
db.prepare("INSERT INTO agents(id,username,role) VALUES (?,'fixture-admin','SUPERADMIN')").run(actor);
db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),actor,Date.now()+60000);
const ids=[];
for(let i=0;i<100;i++){
  const contact=randomUUID(),conv=randomUUID();ids.push(conv);
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id) VALUES (?,?,'HUMAN_ACTIVE',?)").run(conv,contact,actor);
}
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const addr=httpServer.address(),base=`http://127.0.0.1:${addr.port}`;
const socket=client(base,{transports:['websocket'],extraHeaders:{Cookie:`cap_session=${token}`}});
const pct=(values,p)=>values.length?Math.round(values.sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]*1000)/1000:null;
let socketEvents=0;
try{
  await new Promise((resolve,reject)=>{if(socket.connected){resolve();return;}socket.once('connect',resolve);socket.once('connect_error',reject);});
  socket.on('message:created',(_event,ack)=>{socketEvents++;ack({receivedAt:new Date().toISOString()});});
  const clientSamples=[],errors=[];let active=0;const waiting=[];
  async function take(){if(active>=16)await new Promise(resolve=>waiting.push(resolve));active++;return()=>{active--;waiting.shift()?.();};}
  await Promise.all(ids.map(async id=>{
    const release=await take(),start=performance.now();
    try{
      const response=await fetch(`${base}/api/conversations/${id}/messages`,{method:'POST',headers:{Cookie:`cap_session=${token}`,'Content-Type':'application/json'},body:JSON.stringify({text:'Prueba de aceptación local',clientRequestId:randomUUID(),clientCreatedAt:new Date().toISOString()})});
      clientSamples.push(performance.now()-start);
      if(response.status!==202)errors.push(response.status);
    }catch(e){errors.push(e instanceof Error?e.name:'unknown');}finally{release();}
  }));
  for(let i=0;i<100&&socketEvents<100;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const api=db.prepare('SELECT api_accept_ms,socket_ack_ms FROM message_latency WHERE direction=\'outbound\'').all();
  const internal=api.map(x=>x.api_accept_ms).filter(x=>typeof x==='number');
  const ack=api.map(x=>x.socket_ack_ms).filter(x=>typeof x==='number');
  const jobs=(db.prepare("SELECT COUNT(*) AS n FROM outbound_jobs WHERE status='PENDING'").get()).n;
  const result={requests:ids.length,errors,socketEvents,pendingDurableOutboundJobs:jobs,providerCalls:0,apiClientP50Ms:pct(clientSamples,.5),apiClientP95Ms:pct(clientSamples,.95),apiClientP99Ms:pct(clientSamples,.99),apiBackendP50Ms:pct(internal,.5),apiBackendP95Ms:pct(internal,.95),apiBackendP99Ms:pct(internal,.99),socketAckP95Ms:pct(ack,.95),maxClientInFlight:16};
  console.log(JSON.stringify(result));
  if(errors.length||jobs!==100||socketEvents!==100||internal.length!==100)throw new Error('Outbound latency invariant failure');
}finally{socket.disconnect();stopRealtimeRelay();await new Promise(resolve=>httpServer.close(()=>resolve()));}

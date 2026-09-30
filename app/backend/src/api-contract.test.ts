import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';

process.env.NODE_ENV='test';
process.env.DEMO_DB_PATH=':memory:';

test('Every production /api request returns expected JSON, never the Vite index.html; authenticated Socket reconnects',async()=>{
  const {db}=await import('./db.js');
  const {config}=await import('./config.js');
  config.ADMIN_USER='contract-admin';config.ADMIN_PASSWORD='contract-test-password';
  config.MESSAGESYNC_API_KEY='';config.PUBLIC_WEBHOOK_URL='';config.N8N_AI_WEBHOOK_URL='';
  config.GHL_LOCATION_ID='contract-location';config.WEBHOOK_INGRESS_SECRET='contract-ingress-12345678901234567890';
  const {httpServer,stopRealtimeRelay}=await import('./server.js');
  const user=randomUUID(),contact=randomUUID(),active=randomUUID(),closed=randomUUID();
  db.prepare("INSERT INTO agents(id,username,role,manual_status,status) VALUES (?,?,'SUPERADMIN','ONLINE','ONLINE')").run(user,config.ADMIN_USER);
  db.prepare('INSERT INTO contacts(id,provider_contact_id,name) VALUES (?,?,?)').run(contact,'contract-contact','Contract customer');
  for(const [id,mode] of [[active,'HUMAN_ACTIVE'],[closed,'CLOSED']]){
    const sessionContact=mode==='CLOSED'?randomUUID():contact;
    if(mode==='CLOSED')db.prepare('INSERT INTO contacts(id,provider_contact_id,name) VALUES (?,?,?)').run(sessionContact,'closed-contract-contact','Closed contract customer');
    db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id,last_message_at) VALUES (?,?,?,?,datetime('now'))").run(id,sessionContact,mode,user);
    db.prepare("INSERT INTO messages(id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text) VALUES (?,?,?,1,'inbound','customer','HUMAN','text','Contract persisted message')").run(randomUUID(),id,sessionContact);
    db.prepare('UPDATE conversations SET next_sequence=1 WHERE id=?').run(id);
  }
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const address=httpServer.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  let socket:ReturnType<typeof client>|undefined;
  const json=async(path:string,cookie='',method='GET',body?:object,status=200)=>{
    const response=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(response.status,status,path);assert.match(response.headers.get('content-type')||'',/application\/json/,path);
    const text=await response.text();assert.doesNotMatch(text,/<!doctype|<html/i,path);return {response,data:JSON.parse(text)};
  };
  try{
    await json('/api/me','','GET',undefined,401);
    const login=await json('/api/login','','POST',{username:config.ADMIN_USER,password:config.ADMIN_PASSWORD});
    const cookie=login.response.headers.get('set-cookie')!.split(';')[0];
    const paths=['/api/me','/api/conversations','/api/conversations?filter=closed','/api/conversations?filter=ai',`/api/conversations/${closed}`,`/api/conversations/${closed}/messages`,`/api/conversations/${active}/notes`,`/api/conversations/${active}/tags`,'/api/tags','/api/contacts',`/api/contacts/${contact}`,`/api/contacts/${contact}/history`,'/api/agents','/api/users','/api/menu','/api/metrics','/api/metrics/dashboard','/api/health','/api/diagnostics','/api/diagnostics/latency','/api/diagnostics/report','/api/jobs/failed','/api/outbound/jobs'];
    for(const path of paths)await json(path,cookie);
    const archive=(await json('/api/conversations?filter=closed',cookie)).data;
    assert.equal(archive.conversations[0].id,closed);
    const metrics=(await json('/api/metrics/dashboard',cookie)).data;assert.ok(metrics.timings.firstHumanResponse);assert.equal(metrics.global.conversations,2);
    await json('/api/not-an-endpoint',cookie,'GET',undefined,404);
    await json('/api/incidents',cookie,'GET',undefined,404);
    await json('/api/settings',cookie,'GET',undefined,404);
    socket=client(base,{extraHeaders:{Cookie:cookie},transports:['websocket'],reconnection:false});
    const wait=(event:string)=>new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`Socket timeout: ${event}`)),5000);socket!.once(event,data=>{clearTimeout(timeout);resolve(data);});});
    await wait('connect');assert.equal(socket.io.engine.transport.name,'websocket');
    const changed=wait('conversation:changed');
    await json(`/api/conversations/${active}/notes`,cookie,'POST',{text:'Contract private note'},201);
    assert.equal((await changed).id,active);
    const incoming=wait('message:created');socket.on('message:created',(_data,ack)=>ack?.({receivedAt:new Date().toISOString()}));
    await json(`/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,'','POST',{event:'whatsapp.inbound',locationId:config.GHL_LOCATION_ID,timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:'contract-contact'},message:{text:'Contract inbound socket'}}},202);
    const received=await incoming;assert.equal(received.message.text,'Contract inbound socket');assert.equal(received.message.sequence,2);
    socket.disconnect();const reconnected=wait('connect');socket.connect();await reconnected;assert.ok(socket.connected);
    const after=(await json(`/api/conversations/${active}/messages?afterSequence=1`,cookie)).data;
    assert.equal(after.messages[0].text,'Contract inbound socket');
    const sent=await json(`/api/conversations/${active}/messages`,cookie,'POST',undefined,400);
    assert.ok(sent.data.error);
  }finally{socket?.disconnect();stopRealtimeRelay();await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

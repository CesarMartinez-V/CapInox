import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

process.env.NODE_ENV='test';
process.env.DEMO_DB_PATH=':memory:';

test('human-only inbox preserves full causal history, invalid menu never spends AI, close archives and new inbound starts a new session',async()=>{
  const {config}=await import('./config.js');
  const {db}=await import('./db.js');
  const {httpServer}=await import('./server.js');
  const original=globalThis.fetch;
  config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
   config.ADMIN_PASSWORD='fixture-pass';config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';
   config.HANDOFF_NO_AGENT_POLICY='WAIT_QUEUE';
  let providerSends=0,aiCalls=0;
  globalThis.fetch=async(url,init)=>{
    const value=String(url);
    if(value.startsWith('https://api.messagesync.ai/')){providerSends++;return Response.json({id:randomUUID()});}
    if(value.startsWith('https://ai.fixture.test/')){aiCalls++;return Response.json({success:true,route:'AI',reply:'Respuesta simulada'});}
    return original(url,init);
  };
  const wait=async(predicate:()=>boolean)=>{for(let i=0;i<150&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate(),'worker did not finish');};
  try{
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');
    const base=`http://127.0.0.1:${addr.port}`;
    const login=await original(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-pass'})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const api=async(path:string,method='GET',body?:object)=>original(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const send=async(contact:string,text:string,kind='text',media?:object)=>{
      const messageId=randomUUID();
      const response=await original(`${base}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'whatsapp.inbound',eventId:randomUUID(),locationId:'fixture-location',timestamp:new Date().toISOString(),payload:{messageId,contact:{id:contact},message:{text,...(media?{media}:{}),...(kind!=='text'?{type:kind}:{})}}})});
      assert.equal(response.status,202);await wait(()=>Boolean(db.prepare('SELECT processed_at FROM messages WHERE provider_message_id=?').get(messageId) && (db.prepare('SELECT processed_at FROM messages WHERE provider_message_id=?').get(messageId) as {processed_at:string|null}).processed_at));return messageId;
    };
    const a=randomUUID(),b=randomUUID(),c=randomUUID();
    await send(a,'Hola');await send(b,'Hola');
    for(const invalid of ['9','asdf','8','?','hola'])await send(a,invalid);
    assert.equal(aiCalls,0);
    let list=await (await api('/api/conversations')).json();assert.equal(list.conversations.length,0);
    await send(b,'1');await send(b,'Consulta producto');assert.equal(aiCalls,1);
    list=await(await api('/api/conversations?search='+encodeURIComponent(b))).json();assert.equal(list.conversations.length,0);
    await send(c,'Hola');await send(c,'4');
    list=await(await api('/api/conversations')).json();assert.equal(list.conversations.length,1);
    const id=list.conversations[0].id;
    const history=await(await api(`/api/conversations/${id}/messages`)).json();
    assert.deepEqual(history.messages.map((m:{direction:string})=>m.direction),['inbound','outbound','inbound','outbound']);
    assert.deepEqual(history.messages.map((m:{sequence:number})=>m.sequence),[1,2,3,4]);
    assert.equal((await(await api(`/api/conversations/${id}/messages?afterSequence=2`)).json()).messages.length,2);
    db.prepare("UPDATE agents SET status='ONLINE',last_seen_at=?,connection_count=1 WHERE username='admin'").run(new Date().toISOString());
    assert.equal((await api(`/api/conversations/${id}/claim`,'POST')).status,200);
    assert.equal((await api(`/api/conversations/${id}/close`,'POST')).status,400);
    const close=await api(`/api/conversations/${id}/close`,'POST',{disposition:'CONSULT_RESOLVED'});assert.equal(close.status,202);
    await wait(()=>(db.prepare('SELECT mode FROM conversations WHERE id=?').get(id) as {mode:string}).mode==='CLOSED');
    assert.equal((await(await api('/api/conversations')).json()).conversations.length,0);
    const archived=await(await api('/api/conversations?filter=closed')).json();assert.ok(archived.conversations.some((x:{id:string})=>x.id===id));
    assert.deepEqual(db.prepare('SELECT status,disposition FROM conversations WHERE id=?').get(id),{status:'CLOSED',disposition:'CONSULT_RESOLVED'});
    assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND client_message_id=?').get(id,`close:${id}`) as {n:number}).n,1);
    await send(c,'Hola otra vez');
    const sessions=db.prepare('SELECT id,mode FROM conversations WHERE contact_id=(SELECT id FROM contacts WHERE provider_contact_id=?) ORDER BY rowid').all(c) as Array<{id:string;mode:string}>;
    assert.equal(sessions.length,2);assert.equal(sessions[0].mode,'CLOSED');assert.equal(sessions[1].mode,'MENU');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(id) as {n:number}).n,6);
    assert.ok(providerSends>0);
  }finally{globalThis.fetch=original;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

test('real captured provider media array classifies image/audio and rejects private download targets',async()=>{
  const {normalizeProviderEvent}=await import('./normalize.js');
  const {trustedProviderUrl}=await import('./media-service.js');
  for(const kind of ['image','audio']as const){
    const n=normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:randomUUID()},message:{text:kind,media:[{url:`https://storage.googleapis.com/fixture/${kind}`,type:kind}]}}});
    assert.equal(n.messageType,kind);assert.equal(n.attachments.length,1);assert.ok(n.media?.url);
  }
  for(const url of ['http://127.0.0.1/x','http://localhost/x','file:///etc/passwd','https://storage.googleapis.com.evil.test/x','https://169.254.169.254/'])assert.equal(trustedProviderUrl(url),false);
});

test('ambiguous closing send remains UNKNOWN; force close requires audit and never replays',async()=>{
  const {config,getMenu}=await import('./config.js');
  const {db}=await import('./db.js');
  const {httpServer}=await import('./server.js');
  const original=globalThis.fetch;let failClose=true;
  config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';config.HANDOFF_NO_AGENT_POLICY='WAIT_QUEUE';
  globalThis.fetch=async(url,init)=>{
    if(String(url).startsWith('https://api.messagesync.ai/')){
      const body=JSON.parse(String(init?.body));
      if(body.message===getMenu().close&&failClose){failClose=false;throw new Error('fixture provider unavailable');}
      return Response.json({id:randomUUID()});
    }
    return original(url,init);
  };
  try{
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
    const login=await original(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-pass'})});
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const post=async(path:string,body?:object)=>original(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const contact=randomUUID();
    const inbound=async(text:string)=>{
      const msg=randomUUID();
      const r=await original(`${base}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'whatsapp.inbound',locationId:'fixture-location',payload:{messageId:msg,contact:{id:contact},message:{text}}})});
      assert.equal(r.status,202);
      for(let i=0;i<100;i++){if((db.prepare('SELECT processed_at FROM messages WHERE provider_message_id=?').get(msg) as {processed_at:string|null}|undefined)?.processed_at)return;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.fail('worker stalled');
    };
    db.prepare("UPDATE agents SET status='OFFLINE',connection_count=0 WHERE username='admin'").run();
    await inbound('Hola');await inbound('4');
    const c=db.prepare("SELECT id FROM conversations WHERE contact_id=(SELECT id FROM contacts WHERE provider_contact_id=?) ORDER BY rowid DESC LIMIT 1").get(contact) as {id:string};
    db.prepare("UPDATE agents SET status='ONLINE',last_seen_at=?,connection_count=1 WHERE username='admin'").run(new Date().toISOString());
    const claim=await post(`/api/conversations/${c.id}/claim`);assert.equal(claim.status,200,await claim.text());
    assert.equal((await post(`/api/conversations/${c.id}/close`,{disposition:'CONSULT_RESOLVED'})).status,202);
    for(let i=0;i<100;i++){if((db.prepare('SELECT delivery_status FROM messages WHERE client_message_id=?').get(`close:${c.id}`) as {delivery_status:string}|undefined)?.delivery_status==='unknown')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(c.id) as {mode:string}).mode,'HUMAN_ACTIVE');
    assert.equal((db.prepare('SELECT disposition FROM conversations WHERE id=?').get(c.id) as {disposition:string|null}).disposition,null);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE client_message_id=? AND delivery_status=?').get(`close:${c.id}`,'unknown') as {n:number}).n,1);
    assert.equal((await post(`/api/conversations/${c.id}/close`,{disposition:'CONSULT_RESOLVED'})).status,409);
    assert.equal((await post(`/api/conversations/${c.id}/close`,{disposition:'CONSULT_RESOLVED',force:true})).status,202);
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(c.id) as {mode:string}).mode,'CLOSED');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE client_message_id=?').get(`close:${c.id}`) as {n:number}).n,1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='force_close' AND resource_id=?").get(c.id) as {n:number}).n,1);
  }finally{globalThis.fetch=original;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

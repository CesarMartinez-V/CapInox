import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DEMO_DB_PATH = ':memory:';

test('webhook acknowledges, persists, routes once, ignores outbound and rejects wrong Location', async () => {
  const { config } = await import('./config.js');
  const { db } = await import('./db.js');
  const { httpServer } = await import('./server.js');
  const originalFetch=globalThis.fetch;
  config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
  config.GHL_LOCATION_ID='test-location';
  let sends=0;
  globalThis.fetch=async url=>{if(String(url).includes('api.messagesync.ai')){sends++;return Response.json({id:randomUUID()});} return originalFetch(url);};
  try {
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const addr=httpServer.address(); assert.ok(addr && typeof addr!=='string');
    const url=`http://127.0.0.1:${addr.port}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`;
    const id=randomUUID(), contact=randomUUID();
    const payload={event:'whatsapp.inbound',locationId:'test-location',payload:{messageId:id,contact:{id:contact,name:'Demo'},message:{text:'Hola'}}};
    const post=(value:object,target=url)=>originalFetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    assert.equal((await post(payload,`http://127.0.0.1:${addr.port}/webhooks/messagesync/incorrect`)).status,404);
    assert.equal((await post({...payload,locationId:'other-location'})).status,202);
    assert.equal((await post({...payload,event:'whatsapp.outbound'})).status,202);
    assert.equal((await post(payload)).status,202);
    assert.equal((await post(payload)).status,200);
    for(let i=0;i<40&&sends<1;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(sends,1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='inbound'").get() as {n:number}).n,1);
    assert.equal((db.prepare("SELECT route FROM messages WHERE provider_message_id=?").get(id) as {route:string}).route,'MENU');
  } finally {
    globalThis.fetch=originalFetch;
    await new Promise<void>(resolve=>httpServer.close(()=>resolve()));
  }
});

test('message pagination and afterSequence recover exact persisted order after reconnect',async()=>{
  const {config}=await import('./config.js');
  const {httpServer}=await import('./server.js');
  const {persistInbound,setMode}=await import('./db.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  config.ADMIN_PASSWORD='fixture-pass';
  const contact=randomUUID();let id='';
  for(let i=1;i<=125;i++){
    const n=normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:contact},message:{text:`message-${i}`}}});
    const item=persistInbound(n)!;id=item.conversationId;
    if(i===1)setMode(id,'HUMAN_PENDING');
  }
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  try{
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-pass'})});
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const get=async(query='')=>(await(await fetch(`${base}/api/conversations/${id}/messages${query}`,{headers:{Cookie:cookie}})).json());
    const last=await get();assert.equal(last.messages.length,100);assert.equal(last.messages[0].sequence,26);assert.equal(last.messages.at(-1).sequence,125);assert.equal(last.hasMore,true);
    const older=await get('?beforeSequence=26');assert.equal(older.messages.length,25);assert.equal(older.messages[0].sequence,1);assert.equal(older.messages.at(-1).sequence,25);
    const missing=await get('?afterSequence=120');assert.deepEqual(missing.messages.map((x:{sequence:number})=>x.sequence),[121,122,123,124,125]);
  }finally{await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

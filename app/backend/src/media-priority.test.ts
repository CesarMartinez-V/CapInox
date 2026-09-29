import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';process.env.CAP_WORKER_EXTERNAL='true';

test('slow media download does not hold inbound routing of another conversation',async()=>{
  const {db}=await import('./db.js');const {httpServer,stopRealtimeRelay}=await import('./server.js');
  const {startWorker,stopWorker}=await import('./worker.js');const {config}=await import('./config.js');
  config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
  const original=globalThis.fetch;let releaseMedia:((response:Response)=>void)|undefined;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.startsWith('https://storage.googleapis.com/fixture/'))return await new Promise<Response>(resolve=>{releaseMedia=resolve;});
    if(url.startsWith('https://api.messagesync.ai/'))return Response.json({id:randomUUID()});
    return original(input,init);
  };
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));startWorker();
  const address=httpServer.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const inbound=async(contact:string,message:object)=>original(`${base}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'whatsapp.inbound',locationId:'fixture-location',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:contact},message}})});
  try{
    assert.equal((await inbound(randomUUID(),{type:'image',text:'Imagen',media:[{type:'image',url:'https://storage.googleapis.com/fixture/image'}]})).status,202);
    for(let i=0;i<100&&!releaseMedia;i++)await new Promise(r=>setTimeout(r,10));assert.ok(releaseMedia,'media download should start');
    const started=performance.now(),contact=randomUUID();
    assert.equal((await inbound(contact,{text:'Hola'})).status,202);
    for(let i=0;i<200;i++){
      const row=db.prepare("SELECT processed_at FROM messages WHERE contact_id=(SELECT id FROM contacts WHERE provider_contact_id=?) AND direction='inbound'").get(contact) as {processed_at:string|null}|undefined;
      if(row?.processed_at)break;
      await new Promise(r=>setTimeout(r,10));
    }
    const row=db.prepare("SELECT processed_at FROM messages WHERE contact_id=(SELECT id FROM contacts WHERE provider_contact_id=?) AND direction='inbound'").get(contact) as {processed_at:string|null}|undefined;
    assert.ok(row?.processed_at,'text must route while media fetch remains blocked');
    assert.ok(performance.now()-started<2500);
    releaseMedia?.(new Response(Buffer.from('invalid image'),{headers:{'Content-Type':'image/png'}}));
  }finally{stopWorker();stopRealtimeRelay();globalThis.fetch=original;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

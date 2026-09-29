import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';

process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('captured array-shaped image/audio are downloaded, authenticated and served with validated MIME without AI',async()=>{
  const {normalizeProviderEvent}=await import('./normalize.js');
  const {db,persistInbound,setMode}=await import('./db.js');
  const {downloadMedia,mediaDirectory}=await import('./media-service.js');
  const {config}=await import('./config.js');
  const {httpServer}=await import('./server.js');
  const original=globalThis.fetch;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(48,7)]);
  const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(48,3)]);
  const created:string[]=[];
  globalThis.fetch=async(url,init)=>{
    if(String(url).startsWith('https://storage.googleapis.com/fixture/')){
      const audio=String(url).includes('/audio');
      return new Response(audio?mp3:png,{headers:{'Content-Type':audio?'audio/mpeg':'image/png','Content-Length':String(audio?mp3.length:png.length)}});
    }
    return original(url,init);
  };
  try{
    config.ADMIN_PASSWORD='fixture-pass';
    await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
    const login=await original(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-pass'})});
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const contact=randomUUID();
    for(const [kind,mime,bytes] of [['image','image/png',png],['audio','audio/mpeg',mp3]] as const){
      const payload={event:'whatsapp.inbound',eventId:randomUUID(),timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:contact},message:{text:kind,media:[{url:`https://storage.googleapis.com/fixture/${kind}`,type:kind}]}}};
      const item=persistInbound(normalizeProviderEvent(payload))!;setMode(item.conversationId,'HUMAN_PENDING');
      await downloadMedia(item.id);
      const asset=db.prepare('SELECT id,mime_type,storage_path,storage_status FROM media_assets WHERE message_id=?').get(item.id) as {id:string;mime_type:string;storage_path:string;storage_status:string};
      created.push(asset.storage_path);assert.equal(asset.storage_status,'READY');assert.equal(asset.mime_type,mime);
      const row=db.prepare('SELECT message_type,media_url FROM messages WHERE id=?').get(item.id) as {message_type:string;media_url:string};
      assert.equal(row.message_type,kind);assert.equal(row.media_url,`/api/media/${asset.id}`);
      assert.equal((await original(base+row.media_url)).status,401);
      const result=await original(base+row.media_url,{headers:{Cookie:cookie}});
      assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),mime);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
    }
  }finally{
    globalThis.fetch=original;
    await new Promise<void>(resolve=>httpServer.close(()=>resolve()));
    for(const name of created)await rm(resolve(mediaDirectory,name),{force:true});
  }
});

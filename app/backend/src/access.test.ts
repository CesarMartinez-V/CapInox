import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {io as client} from 'socket.io-client';
process.env.NODE_ENV='test';
process.env.DEMO_DB_PATH=':memory:';

test('RBAC denies cross-agent reads and transfer moves access atomically with scoped socket updates',async()=>{
  const {db}=await import('./db.js');
  const {httpServer}=await import('./server.js');
  const {config}=await import('./config.js');
  config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
  const users=[['victor','SUPERADMIN'],['cesar','AGENT'],['daniel','AGENT']] as const;
  const ids=new Map<string,string>(),tokens=new Map<string,string>();
  for(const [name,role] of users){
    const id=randomUUID(),token=randomUUID();ids.set(name,id);tokens.set(name,token);
    db.prepare("INSERT INTO agents(id,username,role,status,max_active_chats) VALUES (?,?,?,'ONLINE',10)").run(id,name,role);
    db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
  }
  const chats:string[]=[],contacts:string[]=[],providerContacts:string[]=[];
  for(const name of ['cesar','daniel']){
    const contact=randomUUID(),conversation=randomUUID();chats.push(conversation);contacts.push(contact);
    const providerContact=randomUUID();providerContacts.push(providerContact);
    db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,providerContact);
    db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id,last_message_at) VALUES (?,?,'HUMAN_ACTIVE',?,datetime('now'))").run(conversation,contact,ids.get(name));
    db.prepare("INSERT INTO messages(id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text) VALUES (?,?,?,1,'inbound','customer','HUMAN','text','Fixture')").run(randomUUID(),conversation,contact);
    db.prepare('UPDATE conversations SET next_sequence=1 WHERE id=?').run(conversation);
  }
  const aiContact=randomUUID(),aiChat=randomUUID();
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(aiContact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode,last_message_at) VALUES (?,?,'AI',datetime('now'))").run(aiChat,aiContact);
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const address=httpServer.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const api=(name:string,path:string,method='GET',body?:object)=>fetch(`${base}${path}`,{method,headers:{Cookie:`cap_session=${tokens.get(name)}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const sockets=[];
  try{
    for(const name of ['cesar','daniel','victor']){
      const own:string=chats[name==='daniel'?1:0],other:string=chats[name==='daniel'?0:1];
      assert.equal((await api(name,`/api/conversations/${own}/messages`)).status,200);
      assert.equal((await api(name,`/api/conversations/${other}`)).status,name==='victor'?200:403);
      assert.equal((await api(name,`/api/conversations/${other}/messages`)).status,name==='victor'?200:403);
    }
    assert.equal((await api('cesar','/api/metrics')).status,403);
    assert.equal((await api('victor','/api/metrics')).status,200);
    const listBefore=await(await api('cesar','/api/conversations')).json();assert.deepEqual(listBefore.conversations.map((x:{id:string})=>x.id),[chats[0]]);
    assert.deepEqual((await(await api('cesar','/api/conversations?filter=ai')).json()).conversations,[]);
    assert.deepEqual((await(await api('victor','/api/conversations?filter=ai')).json()).conversations.map((x:{id:string})=>x.id),[aiChat]);
    assert.equal((await api('cesar',`/api/conversations/${aiChat}`)).status,403);
    assert.deepEqual((await(await api('cesar','/api/contacts')).json()).contacts.map((x:{id:string})=>x.id),[contacts[0]]);
    assert.deepEqual((await(await api('daniel',`/api/contacts?search=${providerContacts[0]}`)).json()).contacts,[]);
    assert.equal((await api('daniel',`/api/contacts/${contacts[0]}`)).status,404);
    assert.equal((await api('cesar',`/api/contacts/${contacts[0]}`)).status,200);
    assert.equal(listBefore.conversations[0].unread_count,1);
    assert.equal((await api('victor',`/api/conversations/${chats[0]}/read`,'POST')).status,200);
    assert.equal((await(await api('cesar','/api/conversations')).json()).conversations[0].unread_count,1);
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}/read`,'POST')).status,200);
    assert.equal((await(await api('cesar','/api/conversations')).json()).conversations[0].unread_count,0);
    assert.equal((await api('daniel',`/api/conversations/${chats[0]}/notes`)).status,403);
    assert.equal((await api('daniel',`/api/contacts/${contacts[0]}/history`)).status,403);
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}/notes`,'POST',{text:'Nota interna sin WhatsApp'})).status,201);
    assert.equal((await api('daniel',`/api/conversations/${chats[0]}/tags`)).status,403);
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}/tags`,'POST',{tagId:'vip'})).status,200);
    assert.equal((await(await api('cesar','/api/conversations?search=VIP')).json()).conversations.length,1);
    assert.equal((await(await api('victor',`/api/conversations/${chats[0]}/notes`)).json()).notes.length,1);
    const cesar=client(base,{extraHeaders:{Cookie:`cap_session=${tokens.get('cesar')}`},transports:['websocket']});
    const daniel=client(base,{extraHeaders:{Cookie:`cap_session=${tokens.get('daniel')}`},transports:['websocket']});
    const victor=client(base,{extraHeaders:{Cookie:`cap_session=${tokens.get('victor')}`},transports:['websocket']});
    sockets.push(cesar,daniel,victor);
    await Promise.all([cesar,daniel,victor].map(s=>new Promise<void>((resolve,reject)=>{if(s.connected){resolve();return;}s.once('connect',resolve);s.once('connect_error',reject);})));
    const scoped={cesar:0,daniel:0,victor:0};
    for(const [name,s] of [['cesar',cesar],['daniel',daniel],['victor',victor]] as const)s.on('message:created',(_data,ack)=>{scoped[name]++;ack?.({receivedAt:new Date().toISOString()});});
    const inbound=async(text:string)=>fetch(`${base}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'whatsapp.inbound',locationId:'fixture-location',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:providerContacts[0]},message:{text}}})});
    assert.equal((await inbound('Privado de César')).status,202);
    for(let i=0;i<50&&scoped.cesar<1;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(scoped,{cesar:1,daniel:0,victor:1});
    const revoked=new Promise<void>(resolve=>cesar.once('inbox:refresh',resolve));
    const received=new Promise<void>(resolve=>daniel.once('conversation:changed',resolve));
    const transfer=await api('cesar',`/api/conversations/${chats[0]}/transfer`,'POST',{toAgentId:ids.get('daniel'),reason:'fixture'});
    assert.equal(transfer.status,200);await Promise.all([revoked,received]);
    assert.equal((await inbound('Privado de Daniel')).status,202);
    for(let i=0;i<50&&scoped.daniel<1;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(scoped,{cesar:1,daniel:1,victor:2});
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}`)).status,403);
    assert.equal((await api('cesar',`/api/contacts/${contacts[0]}`)).status,404);
    assert.equal((await api('daniel',`/api/contacts/${contacts[0]}`)).status,200);
    assert.equal((await api('daniel',`/api/conversations/${chats[0]}`)).status,200);
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}/notes`)).status,403);
    assert.equal((await(await api('daniel',`/api/conversations/${chats[0]}/notes`)).json()).notes.length,1);
    assert.equal((await(await api('daniel',`/api/conversations/${chats[0]}/tags`)).json()).tags[0].name,'VIP');
    assert.equal((await api('victor',`/api/conversations/${chats[0]}`)).status,200);
    assert.equal((await api('cesar',`/api/conversations/${chats[0]}/transfer`,'POST',{toAgentId:null})).status,403);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='transfer'").get() as {n:number}).n,1);
  }finally{for(const s of sockets)s.disconnect();await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

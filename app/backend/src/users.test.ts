import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('superadmin creates hashed users and deactivation requires explicit routing of active chats',async()=>{
  const {db}=await import('./db.js');const {httpServer}=await import('./server.js');
  const victor=randomUUID(),token=randomUUID();
  db.prepare("INSERT INTO agents(id,username,role) VALUES (?,'victor','SUPERADMIN')").run(victor);
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),victor,Date.now()+60000);
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  try{
    const address=httpServer.address();assert.ok(address&&typeof address!=='string');
    const api=(path:string,method='GET',body?:object)=>fetch(`http://127.0.0.1:${address.port}${path}`,{method,headers:{Cookie:`cap_session=${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const created=await api('/api/users','POST',{name:'Daniel CAP',username:'daniel',password:'a long fixture password',role:'AGENT',maxActiveChats:5});assert.equal(created.status,201);
    const {id}=await created.json();
    const row=db.prepare('SELECT password_hash,role FROM agents WHERE id=?').get(id) as {password_hash:string;role:string};
    assert.ok(row.password_hash.includes(':'));assert.ok(!row.password_hash.includes('fixture'));assert.equal(row.role,'AGENT');
    const list=await(await api('/api/users')).text();assert.ok(!list.includes('password_hash'));assert.ok(!list.includes('fixture'));
    const contact=randomUUID(),chat=randomUUID();
    db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
    db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id) VALUES (?,?,'HUMAN_ACTIVE',?)").run(chat,contact,id);
    const rejected=await api(`/api/users/${id}`,'PATCH',{active:false});assert.equal(rejected.status,409);
    assert.equal((await rejected.json()).activeChats,1);
    assert.equal((await api(`/api/users/${id}`,'PATCH',{active:false,deactivateHandling:'QUEUE'})).status,200);
    assert.deepEqual(db.prepare('SELECT mode,assigned_agent_id,assignment_source FROM conversations WHERE id=?').get(chat),{mode:'HUMAN_PENDING',assigned_agent_id:null,assignment_source:'ADMIN'});
    assert.equal((db.prepare('SELECT active FROM agents WHERE id=?').get(id) as {active:number}).active,0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='user_update'").get() as {n:number}).n,1);
  }finally{await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

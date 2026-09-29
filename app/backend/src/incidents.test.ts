import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('incident center separates human/technical explanations, redacts secrets and enforces diagnostic RBAC',async()=>{
  const {db}=await import('./db.js');
  const {recordIncident}=await import('./incidents.js');
  const {httpServer}=await import('./server.js');
  const id=recordIncident({code:'MSYNC_SEND_TIMEOUT',component:'MESSAGESYNC',severity:'ERROR',title:'Mensajes sin confirmar',userMessage:'No pudimos confirmar un mensaje.',technicalMessage:'Bearer sk-private-token timed out after 15s'});
  recordIncident({code:'MSYNC_SEND_TIMEOUT',component:'MESSAGESYNC',severity:'ERROR',title:'Mensajes sin confirmar',userMessage:'No pudimos confirmar un mensaje.',technicalMessage:'rk_private-secret timed out again'});
  const saved=db.prepare('SELECT occurrence_count,user_message,technical_message FROM system_incidents WHERE id=?').get(id) as {occurrence_count:number;user_message:string;technical_message:string};
  assert.equal(saved.occurrence_count,2);assert.ok(saved.user_message.includes('No pudimos'));assert.ok(!saved.technical_message.includes('private'));
  for(const [username,role] of [['agent','AGENT'],['victor','SUPERADMIN']] as const){
    const userId=randomUUID();db.prepare('INSERT INTO agents(id,username,role) VALUES (?,?,?)').run(userId,username,role);
    const token=`session-${username}`;db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),userId,Date.now()+60000);
  }
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  try{
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');
    const api=(name:string,path:string,method='GET')=>fetch(`http://127.0.0.1:${addr.port}${path}`,{method,headers:{Cookie:`cap_session=session-${name}`}});
    assert.equal((await api('agent','/api/diagnostics')).status,403);
    const response=await api('victor','/api/diagnostics');assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.active,1);assert.equal(body.incidents[0].id,id);
    const report=await(await api('victor','/api/diagnostics/report')).text();assert.ok(!report.includes('private'));
    assert.equal((await api('agent',`/api/diagnostics/${id}/resolve`,'POST')).status,403);
    assert.equal((await api('victor',`/api/diagnostics/${id}/resolve`,'POST')).status,200);
    assert.equal((db.prepare('SELECT status FROM system_incidents WHERE id=?').get(id) as {status:string}).status,'RESOLVED');
  }finally{await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

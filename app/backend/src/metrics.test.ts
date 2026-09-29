import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('dashboard counts final assignee dispositions without transfer double-counting and measures human times',async()=>{
  const {db}=await import('./db.js');
  const {dashboard}=await import('./metrics.js');
  const agents=['cesar','daniel'];
  for(const name of agents)db.prepare('INSERT INTO agents(id,username) VALUES (?,?)').run(name,name);
  let n=0;
  for(const [agent,total,sales,consultations] of [['cesar',10,2,5],['daniel',8,1,7]] as const){
    for(let index=0;index<total;index++){
      const contact=randomUUID(),id=randomUUID(),disposition=index<sales?'SALE_COMPLETED':index<sales+consultations?'CONSULT_RESOLVED':'FOLLOW_UP';
      db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
      db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id,final_assignee_id,disposition,created_at,handoff_at,assigned_at,closed_at) VALUES (?,?,'CLOSED',?,?,?,'2026-09-29 09:00:00','2026-09-29 09:01:00','2026-09-29 09:02:00','2026-09-29 09:12:00')").run(id,contact,agent,agent,disposition);
      if(n===0){
        db.prepare("INSERT INTO messages(id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text,created_at) VALUES (?,?,?,1,'outbound','human','HUMAN','text','Hola','2026-09-29 09:03:00')").run(randomUUID(),id,contact);
        db.prepare("INSERT INTO conversation_events(id,conversation_id,event_type,data,created_at) VALUES (?,?,?,'{\"fromAgent\":\"daniel\",\"toAgent\":\"cesar\"}','2026-09-29 09:01:00')").run(randomUUID(),id,'conversation_transferred');
      }
      n++;
    }
  }
  const data=dashboard('2026-09-29 00:00:00','2026-09-30 00:00:00',null) as unknown as {global:{conversations:number;sales:number;consultations:number;transfers:number};timings:{wait:{p50:number};firstHumanResponse:{p50:number};handling:{p95:number}};agents:Array<{id:string;sales:number;closed:number;transfersIn:number}>};
  assert.equal(data.global.conversations,18);assert.equal(data.global.sales,3);assert.equal(data.global.consultations,12);assert.equal(data.global.transfers,1);
  assert.equal(data.timings.wait.p50,60);assert.equal(data.timings.firstHumanResponse.p50,120);assert.equal(data.timings.handling.p95,600);
  assert.deepEqual(data.agents.map(a=>[a.id,a.closed,a.sales]),[['cesar',10,2],['daniel',8,1]]);
  assert.equal(data.agents[0].transfersIn,1);
  const cesar=dashboard('2026-09-29 00:00:00','2026-09-30 00:00:00','cesar') as unknown as {global:{conversations:number;sales:number}};
  assert.equal(cesar.global.conversations,10);assert.equal(cesar.global.sales,2);
});

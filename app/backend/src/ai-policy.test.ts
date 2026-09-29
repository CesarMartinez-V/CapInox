import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('backend never forwards an AI claim that a human transfer already happened',async()=>{
  const {db,getConversation}=await import('./db.js');
  const {config}=await import('./config.js');
  const {askAI}=await import('./ai-service.js');
  const contact=randomUUID(),conversation=randomUUID(),original=globalThis.fetch;
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode,intent) VALUES (?,?,'AI','general')").run(conversation,contact);
  config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';
  globalThis.fetch=async()=>Response.json({success:true,route:'AI',reply:'Ya te conecté con un asesor humano.'});
  try{
    const reply=await askAI(getConversation(conversation)!,'necesito asesor');
    assert.match(reply,/escribe \*asesor\*/i);assert.doesNotMatch(reply,/ya te conect[eé]/i);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE event_type='ai_reply_corrected'").get() as {n:number}).n,1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE event_type='ai_succeeded'").get() as {n:number}).n,1);
  }finally{globalThis.fetch=original;}
});

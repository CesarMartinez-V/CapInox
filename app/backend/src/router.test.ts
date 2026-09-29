import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.DEMO_DB_PATH=':memory:';

test('a real-shaped inbound event is normalized, stored only once, and uses the customer Contact ID', async () => {
  const { normalizeProviderEvent } = await import('./normalize.js');
  const { db, persistInbound, getConversation, getMessage, setMode, event } = await import('./db.js');
  const { routeMessage } = await import('./router.js');
  const contactId=randomUUID(), messageId=randomUUID();
  const payload={version:'1.0',event:'whatsapp.inbound',timestamp:new Date().toISOString(),locationId:'test-location',payload:{messageId,locationId:'test-location',device:{number:'+50400000000'},contact:{id:contactId,number:'+50411111111',name:'Test'},message:{text:'Hola'},meta:{traceId:'trace'}}};
  const n=normalizeProviderEvent(payload);
  assert.equal(n.contactId,contactId);
  assert.equal(n.phone,'+50411111111');
  assert.equal(n.text,'Hola');
  const first=persistInbound(n);
  assert.ok(first);
  assert.equal(persistInbound(n),null);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM messages').get() as {count:number}).count,1);
  setMode(first.conversationId,'HUMAN_PENDING');event(first.conversationId,'handoff_requested');
  await routeMessage(first.id);
  assert.equal(getConversation(first.conversationId)?.mode,'HUMAN_PENDING');
  assert.equal(getMessage(first.id)?.route,'HUMAN');
  assert.ok(getMessage(first.id)?.processed_at);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM messages').get() as {count:number}).count,1);
});

test('concurrent claims are atomic; the first agent wins', async () => {
  const { db, persistInbound, claimConversation } = await import('./db.js');
  const { normalizeProviderEvent } = await import('./normalize.js');
  const n=normalizeProviderEvent({event:'whatsapp.inbound',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:randomUUID()},message:{text:'4'}}});
  const item=persistInbound(n)!;
  db.prepare('INSERT INTO agents(id,username) VALUES (?,?)').run('agent-a','a');
  db.prepare('INSERT INTO agents(id,username) VALUES (?,?)').run('agent-b','b');
  db.prepare("UPDATE conversations SET mode='HUMAN_PENDING' WHERE id=?").run(item.conversationId);
  assert.equal(claimConversation(item.conversationId,'agent-a').ok,true);
  assert.equal(claimConversation(item.conversationId,'agent-b').ok,false);
});

test('number, period and emoji choices normalize without calling an LLM', async () => {
  const { option } = await import('./router.js');
  for(const [input,expected] of [['1','1'],['1.','1'],[' 1 ','1'],['1️⃣','1'],['4️⃣','4'],['0','0']]) assert.equal(option(input),expected);
  assert.equal(option('asdf'),null);
});

test('real router flow keeps menus, humans and media off n8n; closing reopens to welcome; retries deduplicate', async () => {
  const { normalizeProviderEvent } = await import('./normalize.js');
  const { db, persistInbound, getConversation, getMessage, setMode, claimConversation } = await import('./db.js');
  const { config } = await import('./config.js');
  const { routeMessage } = await import('./router.js');
   const originalFetch = globalThis.fetch, oldUrl = config.N8N_AI_WEBHOOK_URL,oldPolicy=config.HANDOFF_NO_AGENT_POLICY;
  const requests: Array<{url:string;body:Record<string,unknown>}> = [];
   config.N8N_AI_WEBHOOK_URL = 'https://test.invalid/ai';
   config.HANDOFF_NO_AGENT_POLICY='WAIT_QUEUE';
  globalThis.fetch = async (url, init) => {
    requests.push({url:String(url),body:JSON.parse(String(init?.body))});
    return Response.json(String(url).includes('test.invalid') ? {success:true,route:'AI',reply:'Respuesta de IA'} : {id:randomUUID()});
  };
  try {
    const contactId = randomUUID(); let seq = 0;
    const inbound = async (text:string, messageType='text', media?:object) => {
      const n = normalizeProviderEvent({event:'whatsapp.inbound',locationId:'test-location',timestamp:new Date(Date.now()+ ++seq*1000).toISOString(),payload:{messageId:randomUUID(),contact:{id:contactId,name:'Demo'},message:{type:messageType,text,...(media?{media}:{})}}});
      const item=persistInbound(n)!; await routeMessage(item.id,item.isNew||item.reopened); return {item,n};
    };
    const calls=()=>requests.filter(r=>r.url.includes('test.invalid'));
    const first=await inbound('Hola'); assert.equal(getMessage(first.item.id)?.route,'MENU'); assert.equal(calls().length,0);
    const firstPair=db.prepare('SELECT direction,route FROM messages WHERE conversation_id=? ORDER BY rowid').all(first.item.conversationId) as Array<{direction:string;route:string}>;
    assert.deepEqual(firstPair.map(m=>m.direction),['inbound','outbound']);
    assert.equal(firstPair[1]?.route,'MENU');
    for (const [choice,intent] of [['1','product_information'],['2','quotation'],['3','general']] as const) {
      if(choice!=='1') await inbound('menú');
      const m=await inbound(choice); assert.equal(getMessage(m.item.id)?.route,'PRESET');
      assert.equal(getConversation(m.item.conversationId)?.intent,intent);
      assert.equal(calls().length,0);
    }
    const query=await inbound('Necesito amortiguadores');
    assert.equal(getMessage(query.item.id)?.route,'AI'); assert.equal(calls().length,1);
    assert.equal(calls()[0]?.body.mode,'AI'); assert.equal(calls()[0]?.body.sessionId,query.item.conversationId);
    await routeMessage(query.item.id); assert.equal(calls().length,1);
    await inbound('Quiero hablar con una persona');
    assert.equal(getConversation(first.item.conversationId)?.mode,'HUMAN_PENDING');
    const sentAtHandoff=requests.length;
    for(const [text,type] of [['Hola','text'],['?','text'],['','image'],['','audio'],['','video']] as const){
      const m=await inbound(text,type,{url:`https://media.example/${type}`}); assert.equal(getMessage(m.item.id)?.route,'HUMAN');
    }
    assert.equal(requests.length,sentAtHandoff);
    db.prepare('INSERT INTO agents(id,username) VALUES (?,?)').run('test-agent','test-agent');
    assert.equal(claimConversation(first.item.conversationId,'test-agent').ok,true);
    assert.equal(claimConversation(first.item.conversationId,'test-agent').ok,false);
    const human=await inbound('Necesito cotizar unas piezas'); assert.equal(getMessage(human.item.id)?.route,'HUMAN');
    assert.equal(requests.length,sentAtHandoff);
    setMode(first.item.conversationId,'CLOSED');
    const reopened=await inbound('Hola otra vez'); assert.equal(reopened.item.reopened,true);
    assert.equal(getMessage(reopened.item.id)?.route,'MENU'); assert.equal(requests.length,sentAtHandoff+1);
   } finally { globalThis.fetch=originalFetch; config.N8N_AI_WEBHOOK_URL=oldUrl;config.HANDOFF_NO_AGENT_POLICY=oldPolicy; }
});

test('AI network error stays in SQLite and sends a preset without retry loops', async () => {
  const { normalizeProviderEvent } = await import('./normalize.js');
  const { db, persistInbound, getMessage, getConversation, setMode } = await import('./db.js');
  const { config } = await import('./config.js');
  const { routeMessage } = await import('./router.js');
  const originalFetch=globalThis.fetch, oldUrl=config.N8N_AI_WEBHOOK_URL;
  config.N8N_AI_WEBHOOK_URL='https://test.invalid/ai';
  let calls=0;
  globalThis.fetch=async url => { if(String(url).includes('test.invalid')) { calls++; throw new Error('offline'); } return Response.json({id:randomUUID()}); };
  try {
    const id=randomUUID();
    const n=normalizeProviderEvent({event:'whatsapp.inbound',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id},message:{text:'consulta'}}});
    const initial=persistInbound(n)!; await routeMessage(initial.id,true);
    setMode(initial.conversationId,'AI','general');
    const next=normalizeProviderEvent({event:'whatsapp.inbound',timestamp:new Date(Date.now()+1000).toISOString(),payload:{messageId:randomUUID(),contact:{id},message:{text:'consulta adicional'}}});
    const item=persistInbound(next)!;await routeMessage(item.id);
    assert.equal(calls,1); assert.equal(getMessage(item.id)?.route,'PRESET');
    assert.ok(getMessage(item.id)?.processed_at);
    assert.equal((db.prepare("SELECT menu_state FROM conversations WHERE id=?").get(item.conversationId) as {menu_state:string}).menu_state,'AI_ERROR');
    assert.equal(getConversation(item.conversationId)?.mode,'AI');
    const last=db.prepare("SELECT text FROM messages WHERE conversation_id=? AND direction='outbound' ORDER BY sequence DESC LIMIT 1").get(item.conversationId) as {text:string};
    assert.match(last.text,/intenta nuevamente/i);assert.doesNotMatch(last.text,/conectarte con un asesor/i);
    await routeMessage(item.id); assert.equal(calls,1);
  } finally { globalThis.fetch=originalFetch; config.N8N_AI_WEBHOOK_URL=oldUrl; }
});

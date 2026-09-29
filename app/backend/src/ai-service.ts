import { config } from './config.js';
import { db, event, getContact, type Conversation } from './db.js';

export interface KnowledgeProvider { search(query:string,context:{intent:string}):Promise<string[]> }
export class NullKnowledgeProvider implements KnowledgeProvider { async search(_query:string,_context:{intent:string}){return [];} }
export const knowledge:KnowledgeProvider=new NullKnowledgeProvider();

let failures=0,openUntil=0;
export async function askAI(conversation:Conversation,text:string){
  if(!config.N8N_AI_WEBHOOK_URL)throw new Error('AI Engine no configurado');
  if(Date.now()<openUntil)throw new Error('Circuit breaker activo');
  const count=(db.prepare(`SELECT COUNT(*) AS n FROM conversation_events e JOIN conversations v ON v.id=e.conversation_id
    WHERE v.contact_id=? AND e.event_type='n8n_called' AND e.created_at>=datetime('now','-1 minute')`).get(conversation.contact_id) as {n:number}).n;
  if(count>=config.AI_MAX_CALLS_PER_MINUTE_PER_CONTACT){event(conversation.id,'ai_rate_limited');throw new Error('AI rate limit');}
  const contact=getContact(conversation.contact_id)!;
  const history=db.prepare(`SELECT sender_type AS role,text FROM messages WHERE conversation_id=? AND text<>'' AND direction IN ('inbound','outbound')
    ORDER BY sequence DESC LIMIT 12`).all(conversation.id).reverse();
  const references=await knowledge.search(text,{intent:conversation.intent||'general'});
  event(conversation.id,'n8n_called',{mode:conversation.mode});
  try{
    const response=await fetch(config.N8N_AI_WEBHOOK_URL,{
      method:'POST',headers:{'Content-Type':'application/json',...(config.N8N_INTERNAL_TOKEN?{'X-CAP-Internal-Token':config.N8N_INTERNAL_TOKEN}:{})},
      body:JSON.stringify({mode:'AI',contactId:contact.provider_contact_id,conversationId:conversation.id,customerName:contact.name||'',
        text,intent:conversation.intent||'general',sessionId:conversation.id,history,references}),
      signal:AbortSignal.timeout(25000),
    });
    if(!response.ok)throw new Error(`AI Engine HTTP ${response.status}`);
    const data:unknown=await response.json();
    if(!data||typeof data!=='object'||!('success' in data)||!('reply' in data)||data.success!==true||typeof data.reply!=='string'||!data.reply.trim())throw new Error('AI Engine response inválida');
    failures=0;return data.reply.trim();
  }catch(error){
    event(conversation.id,'ai_failed');
    if(++failures>=5){openUntil=Date.now()+60000;failures=0;}
    throw error;
  }
}

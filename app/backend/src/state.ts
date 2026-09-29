import { db, event, getConversation, type Conversation } from './db.js';

export type Transition='SELECT_AI'|'REQUEST_HUMAN'|'RETURN_MENU'|'CLAIM'|'BEGIN_CLOSE'|'CONFIRM_CLOSE'|'CLOSE_FAILED';
const allowed:Record<Transition,Conversation['mode'][]>= {
  SELECT_AI:['MENU'], REQUEST_HUMAN:['MENU','AI'], RETURN_MENU:['AI','HUMAN_PENDING','HUMAN_ACTIVE'],
  CLAIM:['HUMAN_PENDING'], BEGIN_CLOSE:['HUMAN_ACTIVE'], CONFIRM_CLOSE:['CLOSING'],CLOSE_FAILED:['CLOSING'],
};
const target:Record<Transition,Conversation['mode']>={
  SELECT_AI:'AI',REQUEST_HUMAN:'HUMAN_PENDING',RETURN_MENU:'MENU',CLAIM:'HUMAN_ACTIVE',BEGIN_CLOSE:'CLOSING',CONFIRM_CLOSE:'CLOSED',CLOSE_FAILED:'HUMAN_ACTIVE',
};
const eventNames:Record<Transition,string>={SELECT_AI:'ai_selected',REQUEST_HUMAN:'handoff_requested',RETURN_MENU:'returned_to_bot',CLAIM:'human_claimed',BEGIN_CLOSE:'closing_requested',CONFIRM_CLOSE:'closed',CLOSE_FAILED:'closing_failed'};
export const transitionConversation=db.transaction((id:string, transition:Transition, options:{intent?:string;agentId?:string}={})=>{
  const current=getConversation(id);
  if (!current || !allowed[transition].includes(current.mode)) return {ok:false,reason:current?'Transición inválida':'No existe'} as const;
  const next=target[transition];
  const agentId=transition==='CLAIM'?options.agentId : next==='HUMAN_ACTIVE'||next==='CLOSING'?current.assigned_agent_id:null;
  if (transition==='CLAIM') {
    if (!agentId) return {ok:false,reason:'Agente requerido'} as const;
    const agent=db.prepare('SELECT active,max_active_chats FROM agents WHERE id=?').get(agentId) as {active:number;max_active_chats:number}|undefined;
    const count=(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE assigned_agent_id=? AND mode IN ('HUMAN_ACTIVE','CLOSING')").get(agentId) as {n:number}).n;
    if (!agent?.active || count>=agent.max_active_chats) return {ok:false,reason:'Agente sin capacidad'} as const;
  }
  const update=db.prepare(`UPDATE conversations SET mode=?,intent=?,assigned_agent_id=?,menu_state=NULL,
    status=?,closed_at=CASE WHEN ?='CLOSED' THEN datetime('now') ELSE closed_at END,
    handoff_at=CASE WHEN ?='HUMAN_PENDING' THEN datetime('now') ELSE handoff_at END,
    updated_at=datetime('now') WHERE id=? AND mode=?`).run(next,transition==='SELECT_AI'?options.intent||'general':null,agentId,
      next==='CLOSED'?'CLOSED':next==='CLOSING'?'CLOSING':'open',next,next,id,current.mode);
  if (!update.changes) return {ok:false,reason:'Estado cambió concurrentemente'} as const;
  for(const agent of new Set([current.assigned_agent_id,agentId].filter(Boolean))) {
    db.prepare(`UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode IN ('HUMAN_ACTIVE','CLOSING')) WHERE id=?`).run(agent,agent);
  }
  if (transition==='CLAIM' && agentId) db.prepare("UPDATE agents SET last_assigned_at=datetime('now') WHERE id=?").run(agentId);
  event(id,eventNames[transition],agentId?{agentId}:{ });
  return {ok:true,mode:next} as const;
});

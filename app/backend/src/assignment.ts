import { config, getMenu } from './config.js';
import { randomUUID } from 'node:crypto';
import { db, getConversation, event } from './db.js';
import { transitionConversation } from './state.js';
import { availableAgent } from './availability.js';

type Agent={id:string;load:number};
let emit:(id:string,revokedAgentId?:string)=>void=()=>{};
export function assignmentChanged(callback:(id:string,revokedAgentId?:string)=>void){emit=callback;}

export async function assignPending(force=false) {
  if(!force&&config.AUTO_ASSIGN_HUMAN!=='true')return 0;
  let assigned=0;
  for(;;){
    const pending=db.prepare("SELECT id FROM conversations v WHERE mode='HUMAN_PENDING' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.conversation_id=v.id AND j.status='PROCESSING') ORDER BY handoff_at ASC,id ASC LIMIT 1").get() as {id:string}|undefined;
    if(!pending)break;
    const agent=availableAgent();
    if(!agent)break;
    const result=transitionConversation(pending.id,'CLAIM',{agentId:agent.id,assignmentSource:'AUTO'});
    if(!result.ok)break;
    db.prepare('INSERT INTO audit_log(id,action,resource_type,resource_id,after_json) VALUES (?,?,?,?,?)').run(randomUUID(),'assignment_auto','conversation',pending.id,JSON.stringify({agentId:agent.id}));
    assigned++;emit(pending.id);
    try {
      const {sendReply}=await import('./router.js');
      await sendReply(getConversation(pending.id)!,getMenu().claim,'human','HUMAN');
    } catch { /* The failed outbound bubble remains available for manual follow-up. */ }
  }
  return assigned;
}

/** Human chats never silently return to AI after a disconnected agent's grace period. */
export function reassignDisconnected(){
  const cutoff=new Date(Date.now()-config.AGENT_DISCONNECT_GRACE_SECONDS*1000).toISOString();
  const stale=db.prepare(`SELECT v.id,v.assigned_agent_id,v.needs_reassignment FROM conversations v JOIN agents a ON a.id=v.assigned_agent_id
    WHERE v.mode='HUMAN_ACTIVE' AND (a.active=0 OR a.connection_count=0 OR a.manual_status='OFFLINE')
      AND (a.last_seen_at IS NULL OR a.last_seen_at<?) ORDER BY v.handoff_at,v.id LIMIT 100`).all(cutoff) as Array<{id:string;assigned_agent_id:string;needs_reassignment:number}>;
  for(const c of stale){
    const next=availableAgent(c.assigned_agent_id);
    if(!next&&c.needs_reassignment)continue;
    const changed=db.transaction(()=>{
      const update=db.prepare(`UPDATE conversations SET needs_reassignment=?,assigned_agent_id=CASE WHEN ? IS NULL THEN assigned_agent_id ELSE ? END,
        assignment_source=CASE WHEN ? IS NULL THEN assignment_source ELSE 'AUTO' END,
        assigned_at=CASE WHEN ? IS NULL THEN assigned_at ELSE datetime('now') END,version=version+1
        WHERE id=? AND mode='HUMAN_ACTIVE' AND assigned_agent_id=?`).run(next?0:1,next?.id??null,next?.id??null,next?.id??null,next?.id??null,c.id,c.assigned_agent_id);
      if(!update.changes)return false;
      if(next){
        db.prepare("UPDATE agents SET last_assigned_at=datetime('now'),active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE') WHERE id=?").run(next.id,next.id);
        db.prepare("UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE') WHERE id=?").run(c.assigned_agent_id,c.assigned_agent_id);
      }
      event(c.id,next?'conversation_transferred':'needs_reassignment',{fromAgent:c.assigned_agent_id,toAgent:next?.id||null,reason:'disconnect_grace_expired'});
      return true;
    })();
    if(changed)emit(c.id,next?.id?c.assigned_agent_id:undefined);
  }
  return stale.length;
}

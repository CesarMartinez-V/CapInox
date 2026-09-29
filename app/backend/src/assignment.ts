import { config, getMenu } from './config.js';
import { db, getConversation } from './db.js';
import { transitionConversation } from './state.js';

type Agent={id:string;load:number};
let emit:(id:string)=>void=()=>{};
export function assignmentChanged(callback:(id:string)=>void){emit=callback;}

export async function assignPending() {
  if(config.AUTO_ASSIGN_HUMAN!=='true')return 0;
  let assigned=0;
  for(;;){
    const pending=db.prepare("SELECT id FROM conversations WHERE mode='HUMAN_PENDING' ORDER BY handoff_at ASC,id ASC LIMIT 1").get() as {id:string}|undefined;
    if(!pending)break;
    const cutoff=new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString();
    const agent=db.prepare(`SELECT a.id,COUNT(v.id) AS load FROM agents a LEFT JOIN conversations v
      ON v.assigned_agent_id=a.id AND v.mode IN ('HUMAN_ACTIVE','CLOSING')
      WHERE a.active=1 AND a.status='ONLINE' AND a.last_seen_at>=?
      GROUP BY a.id HAVING load<a.max_active_chats
      ORDER BY load ASC,COALESCE(a.last_assigned_at,'') ASC,a.id ASC LIMIT 1`).get(cutoff) as Agent|undefined;
    if(!agent)break;
    const result=transitionConversation(pending.id,'CLAIM',{agentId:agent.id});
    if(!result.ok)break;
    assigned++;emit(pending.id);
    try {
      const {sendReply,enqueue}=await import('./router.js');
      await enqueue(pending.id,()=>sendReply(getConversation(pending.id)!,getMenu().claim,'human','HUMAN').then(()=>{}));
    } catch { /* The failed outbound bubble remains available for manual follow-up. */ }
  }
  return assigned;
}

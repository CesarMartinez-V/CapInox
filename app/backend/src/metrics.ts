import { db } from './db.js';
import { config } from './config.js';

type Timings={wait:number[];firstResponse:number[];handling:number[]};
const percentile=(items:number[],p:number)=>items.length?Math.round(items[Math.min(items.length-1,Math.ceil(items.length*p)-1)]):null;
const summary=(values:number[])=>{const sorted=values.sort((a,b)=>a-b);return {count:sorted.length,mean:sorted.length?Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length):null,p50:percentile(sorted,.5),p95:percentile(sorted,.95)};};
export function dashboard(from:string,to:string,agentId:string|null){
  const scope=`AND (@agent IS NULL OR v.assigned_agent_id=@agent OR v.final_assignee_id=@agent OR v.closed_by=@agent)`;
  const args={from,to,agent:agentId};
  const conversations=db.prepare(`SELECT COUNT(*) AS conversations,
    SUM(mode IN ('HUMAN_PENDING','HUMAN_ACTIVE','CLOSING','CLOSED')) AS human_chats,
    SUM(mode='AI') AS ai_open,
    SUM(mode='HUMAN_PENDING') AS pending,
    SUM(mode='HUMAN_ACTIVE') AS active,
    SUM(needs_reassignment=1) AS needsReassignment,
    SUM(mode='CLOSED') AS closed,
    SUM(disposition='SALE_COMPLETED') AS sales,
    SUM(disposition='CONSULT_RESOLVED') AS consultations,
    SUM(disposition='QUOTE_SENT') AS quotes,
    SUM(disposition='FOLLOW_UP') AS followups
    FROM conversations v WHERE v.created_at>=@from AND v.created_at<@to ${scope}`).get(args);
  const messages=db.prepare(`SELECT SUM(m.direction='inbound') AS inbound,SUM(m.direction='outbound') AS outbound,
    SUM(m.route='MENU' AND m.direction='outbound') AS menus,
    SUM(m.route='PRESET' AND m.direction='outbound') AS presets,
    SUM(m.route='AI' AND m.direction='outbound') AS aiReplies,
    SUM(m.delivery_status='failed') AS failed
    FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE m.created_at>=@from AND m.created_at<@to ${scope}`).get(args);
  const events=db.prepare(`SELECT SUM(e.event_type='handoff_requested') AS handoffs,
    SUM(e.event_type='handoff_unavailable_ai_fallback') AS noAgentFallbacks,
    SUM(e.event_type='n8n_called') AS aiCalls,
    SUM(e.event_type='ai_failed') AS aiFailures,
    SUM(e.event_type='conversation_transferred') AS transfers
    FROM conversation_events e JOIN conversations v ON v.id=e.conversation_id WHERE e.created_at>=@from AND e.created_at<@to ${scope}`).get(args);
  const timingRows=db.prepare(`SELECT v.handoff_at,v.assigned_at,v.closed_at,
    (SELECT MIN(m.created_at) FROM messages m WHERE m.conversation_id=v.id AND m.direction='outbound' AND m.sender_type='human' AND m.created_at>=v.handoff_at) AS first_human_at
    FROM conversations v WHERE v.created_at>=@from AND v.created_at<@to ${scope}`).all(args) as Array<{handoff_at:string|null;assigned_at:string|null;closed_at:string|null;first_human_at:string|null}>;
  const seconds=(begin:string|null,end:string|null)=>begin&&end?Math.max(0,Math.round((Date.parse(end.replace(' ','T')+'Z')-Date.parse(begin.replace(' ','T')+'Z'))/1000)):null;
  const timings:Timings={wait:[],firstResponse:[],handling:[]};
  const aiLatencies=(db.prepare(`SELECT json_extract(e.data,'$.durationMs') AS duration FROM conversation_events e JOIN conversations v ON v.id=e.conversation_id
    WHERE e.event_type='ai_succeeded' AND e.created_at>=@from AND e.created_at<@to ${scope}`).all(args) as Array<{duration:number|null}>).map(x=>x.duration).filter((x):x is number=>typeof x==='number'&&x>=0).map(x=>x/1000);
  for(const row of timingRows){const wait=seconds(row.handoff_at,row.assigned_at),first=seconds(row.handoff_at,row.first_human_at),handling=seconds(row.assigned_at,row.closed_at);if(wait!==null)timings.wait.push(wait);if(first!==null)timings.firstResponse.push(first);if(handling!==null)timings.handling.push(handling);}
  const agents=db.prepare(`SELECT a.id,a.username,a.name,CASE WHEN a.connection_count=0 OR a.last_seen_at IS NULL OR a.last_seen_at<@cutoff THEN 'OFFLINE' WHEN a.status='ONLINE' AND a.active_chat_count>=a.max_active_chats THEN 'BUSY' ELSE a.status END AS status,a.active_chat_count,a.max_active_chats,
    (SELECT COUNT(*) FROM conversations v WHERE v.final_assignee_id=a.id AND v.closed_at>=@from AND v.closed_at<@to) AS closed,
    (SELECT COUNT(*) FROM conversations v WHERE v.disposition='SALE_COMPLETED' AND v.final_assignee_id=a.id AND v.closed_at>=@from AND v.closed_at<@to) AS sales,
    (SELECT COUNT(*) FROM conversations v WHERE v.disposition='CONSULT_RESOLVED' AND v.final_assignee_id=a.id AND v.closed_at>=@from AND v.closed_at<@to) AS consultations,
    (SELECT COUNT(*) FROM conversation_events e WHERE e.event_type='conversation_transferred' AND json_extract(e.data,'$.fromAgent')=a.id AND e.created_at>=@from AND e.created_at<@to) AS transfersOut,
    (SELECT COUNT(*) FROM conversation_events e WHERE e.event_type='conversation_transferred' AND json_extract(e.data,'$.toAgent')=a.id AND e.created_at>=@from AND e.created_at<@to) AS transfersIn
    FROM agents a WHERE a.active=1 AND (@agent IS NULL OR a.id=@agent) ORDER BY a.username`).all({...args,cutoff:new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString()});
  const late=(db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_PENDING' AND handoff_at IS NOT NULL AND (julianday('now')-julianday(handoff_at))*86400>?`).get(config.CRITICAL_WAIT_SECONDS) as {n:number}).n;
  return {range:{from,to,agentId},global:{...conversations as object,...messages as object,...events as object},timings:{wait:summary(timings.wait),firstHumanResponse:summary(timings.firstResponse),handling:summary(timings.handling),aiLatencySeconds:summary(aiLatencies)},agents,sla:{warnSeconds:config.WARN_WAIT_SECONDS,criticalSeconds:config.CRITICAL_WAIT_SECONDS,criticalPending:late}};
}

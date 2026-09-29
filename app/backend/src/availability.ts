import { db } from './db.js';
import { config } from './config.js';

export type AvailableAgent={id:string;load:number;max_active_chats:number;last_assigned_at:string|null};
const cutoff=()=>new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString();
export function availableAgent(excludeId?:string):AvailableAgent|undefined{
  return db.prepare(`SELECT a.id,a.max_active_chats,a.last_assigned_at,COUNT(v.id) AS load
    FROM agents a LEFT JOIN conversations v ON v.assigned_agent_id=a.id AND v.mode IN ('HUMAN_ACTIVE','CLOSING')
    WHERE a.active=1 AND a.can_receive_chats=1 AND a.manual_status='ONLINE' AND a.connection_count>0
      AND a.status='ONLINE' AND a.last_seen_at>=? AND (? IS NULL OR a.id<>?)
    GROUP BY a.id HAVING load<a.max_active_chats
    ORDER BY load ASC,COALESCE(a.last_assigned_at,'') ASC,a.id ASC LIMIT 1`).get(cutoff(),excludeId??null,excludeId??null) as AvailableAgent|undefined;
}
export function isAvailable(id:string){return availableAgent()?.id===id||Boolean(db.prepare(`SELECT 1 FROM agents a WHERE a.id=? AND a.active=1 AND a.can_receive_chats=1
  AND a.status='ONLINE' AND a.manual_status='ONLINE' AND a.connection_count>0 AND a.last_seen_at>=?
  AND (SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=a.id AND mode IN ('HUMAN_ACTIVE','CLOSING'))<a.max_active_chats`).get(id,cutoff()));}

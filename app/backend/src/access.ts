import type { Conversation } from './db.js';
export type Role='AGENT'|'ADMIN'|'SUPERADMIN';
export type Permission='conversation.view_own'|'conversation.view_all'|'conversation.reply_own'|'conversation.reply_all'|'conversation.claim'|'conversation.transfer_own'|'conversation.transfer_all'|'conversation.close_own'|'conversation.close_all'|'conversation.reopen'|'conversation.assign'|'metrics.view_own'|'metrics.view_all'|'diagnostics.view'|'diagnostics.retry'|'users.manage'|'roles.manage'|'campaigns.view'|'campaigns.create'|'campaigns.manage'|'settings.manage'|'audit.view';
export type Principal={id:string;username:string;role:Role};
const own:Permission[]=['conversation.view_own','conversation.reply_own','conversation.claim','conversation.transfer_own','conversation.close_own','metrics.view_own'];
const team:Permission[]=['conversation.view_all','conversation.reply_all','conversation.transfer_all','conversation.close_all','conversation.reopen','conversation.assign','metrics.view_all','diagnostics.view','campaigns.view','campaigns.create','campaigns.manage'];
const root:Permission[]=['users.manage','roles.manage','diagnostics.retry','settings.manage','audit.view'];
export const rolePermissions:Record<Role,ReadonlySet<Permission>>={
  AGENT:new Set(own),ADMIN:new Set([...own,...team]),SUPERADMIN:new Set([...own,...team,...root]),
};
export const hasPermission=(actor:Principal,permission:Permission)=>rolePermissions[actor.role]?.has(permission)??false;
export function canView(actor:Principal,c:Conversation){
  return hasPermission(actor,'conversation.view_all')||hasPermission(actor,'conversation.view_own')&&(c.assigned_agent_id===actor.id||c.mode==='HUMAN_PENDING'&&!c.assigned_agent_id);
}
export function canModify(actor:Principal,c:Conversation,own:Permission,all:Permission){
  return hasPermission(actor,all)||c.assigned_agent_id===actor.id&&hasPermission(actor,own);
}

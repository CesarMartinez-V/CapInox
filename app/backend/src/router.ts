import { config, getMenu } from './config.js';
import { db, event, getContact, getConversation, getMessage, insertOutbound, type Conversation } from './db.js';
import { wakeOutbound } from './outbound.js';
import { availableAgent } from './availability.js';
import { transitionConversation } from './state.js';
import { askAI } from './ai-service.js';
import { monotonic,elapsed,mark,measure } from './latency.js';
import { queueRealtime } from './realtime.js';

type Change = (id: string) => void;
let changed: Change = id => queueRealtime('conversation.changed',id);
export function onChange(callback: Change) { changed = callback; }
let messageCreated:(id:string,conversationId:string)=>void=(id,conversationId)=>queueRealtime('message.created',conversationId,id);
export function onMessageCreated(callback:(id:string,conversationId:string)=>void){messageCreated=callback;}
const queues = new Map<string, Promise<void>>();
export function enqueue(conversationId: string, task: () => Promise<void>) {
  const old = queues.get(conversationId) || Promise.resolve();
  const next = old.catch(() => {}).then(task);
  queues.set(conversationId, next);
  void next.finally(() => { if (queues.get(conversationId) === next) queues.delete(conversationId); }).catch(() => {});
  return next;
}
const normalizeCommand = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/[.!?]+$/,'').trim();
const menuCommands = new Set(['menu', 'inicio', '0', '0.']);
const humanCommands = new Set(['asesor', 'asesor humano', 'humano', 'persona', 'agente', 'hablar con alguien', 'quiero hablar con alguien', 'quiero un asesor', 'quiero hablar con una persona','pasame con un asesor','pasame con asesor','quiero hablar con un asesor']);
export const isHumanRequest=(value:string)=>humanCommands.has(normalizeCommand(value));
export const isMenuCommand=(value:string)=>menuCommands.has(normalizeCommand(value))||normalizeMenuOption(value)==='0';
export function normalizeMenuOption(value: string) {
  const match = value.trim().match(/^([0-4])\s*(?:\.|\uFE0F?\u20E3)?\s*$/u);
  return match?.[1] || null;
}
export const option=normalizeMenuOption;

export async function sendReply(conversation: Conversation, text: string, sender: 'bot'|'human', route: 'MENU'|'PRESET'|'AI'|'HUMAN', attachments: string[] = [], mimeType?: string, fileName?: string, replyTo?:string, clientId?:string, clientCreatedAt?:string, apiReceivedAt?:string) {
  const contact = getContact(conversation.contact_id);
  if (!contact?.provider_contact_id) throw new Error('Contact ID ausente');
  const started=monotonic();
  const saved = insertOutbound(conversation, text, sender, route, attachments[0], mimeType, fileName, replyTo, clientId,clientCreatedAt,apiReceivedAt);
  const id=saved.id;
  if (!saved.created) return id;
  mark(id,'db_persisted_at');measure(id,'db_persist_ms',elapsed(started));
  messageCreated(id,conversation.id);
  changed(conversation.id);
  if(process.env.CAP_WORKER_EXTERNAL!=='true')wakeOutbound();
  return id;
}

export async function routeMessage(messageId: string, isNew = false, combined?:{text:string;ids:string[]}) {
  const msg = getMessage(messageId);
  if (!msg || msg.processed_at || msg.direction !== 'inbound') return;
  const id = msg.conversation_id;
  const conversation = getConversation(id);
  if (!conversation) return;
  const menu = getMenu();
  const state = db.prepare('SELECT menu_state FROM conversations WHERE id=?').get(id) as {menu_state:string|null};
  const finish = (route: string) => {
    db.transaction(()=>{for(const item of [messageId,...(combined?.ids||[])]){
      db.prepare("UPDATE messages SET route=?,processed_at=datetime('now') WHERE id=? AND processed_at IS NULL").run(route,item);
      queueRealtime('message.updated',id,item);
    }})();
    changed(id);
  };
  const reply = async (text: string, route: 'MENU'|'PRESET'|'AI') => {
    await sendReply(getConversation(id)!, text, 'bot', route,[],undefined,undefined,messageId);
    finish(route);
  };
  const requestHuman=async()=>{
    if(availableAgent()||config.HANDOFF_NO_AGENT_POLICY==='WAIT_QUEUE'){
      const transition=transitionConversation(id,'REQUEST_HUMAN');if(!transition.ok)throw new Error(transition.reason);
      changed(id);await reply(menu.options['4'].reply,'PRESET');return;
    }
    const before=db.prepare('SELECT last_unavailable_at FROM conversations WHERE id=?').get(id) as {last_unavailable_at:number|null};
    const change=transitionConversation(id,'HUMAN_UNAVAILABLE');if(!change.ok)throw new Error(change.reason);
    changed(id);
    if(before.last_unavailable_at&&Date.now()-before.last_unavailable_at<60000){finish('PRESET');return;}
    db.prepare('UPDATE conversations SET last_unavailable_at=? WHERE id=?').run(Date.now(),id);
    await reply(menu.noAgent,'PRESET');
  };
  if (conversation.mode === 'HUMAN_PENDING' || conversation.mode === 'HUMAN_ACTIVE' || conversation.mode === 'CLOSING' || conversation.mode === 'CLOSED') { finish('HUMAN'); return; }
  if (isNew || msg.sequence===1 || state.menu_state === 'REOPEN_PENDING') {
    db.prepare('UPDATE conversations SET menu_state=NULL WHERE id=?').run(id);
    await reply(menu.welcome, 'MENU'); return;
  }
  const command = normalizeCommand(msg.text);
  if (isHumanRequest(msg.text) && msg.message_type === 'text') {
    await requestHuman();return;
  }
  const choice = normalizeMenuOption(msg.text);
  if (isMenuCommand(msg.text) || choice === '0') {
    if (conversation.mode==='AI') transitionConversation(id,'RETURN_MENU');
    changed(id);
    await reply(menu.welcome, 'MENU'); return;
  }
  if (msg.message_type !== 'text') {
    if (msg.message_type === 'image' || msg.message_type === 'sticker') await reply(menu.image, 'PRESET');
    else if (msg.message_type === 'audio') await reply(menu.audio, 'PRESET');
    else if (msg.message_type === 'video') await reply(menu.video, 'PRESET');
    else finish('PRESET');
    return;
  }
  const current = getConversation(id)!;
  if (state.menu_state === 'AI_ERROR' && choice === '2') {
    db.prepare('UPDATE conversations SET menu_state=NULL WHERE id=?').run(id);
    await requestHuman();return;
  }
  let aiQuery = combined?.text||msg.text;
  if (state.menu_state === 'AI_ERROR' && choice === '1') {
    const previousRequest = db.prepare("SELECT text FROM messages WHERE conversation_id=? AND id<>? AND direction='inbound' AND text<>'' ORDER BY rowid DESC LIMIT 1").get(id,msg.id) as {text:string}|undefined;
    aiQuery = previousRequest?.text || msg.text;
    db.prepare('UPDATE conversations SET menu_state=NULL WHERE id=?').run(id);
  }
  if (current.mode === 'MENU') {
    if (choice && menu.options[choice]) {
      if (choice === '4') {
        await requestHuman();return;
      } else transitionConversation(id,'SELECT_AI',{intent:menu.options[choice].intent});
      await reply(menu.options[choice].reply,'PRESET');
    } else {
      db.prepare('UPDATE conversations SET invalid_menu_attempts=invalid_menu_attempts+1 WHERE id=?').run(id);
      await reply(menu.invalid, 'MENU');
    }
    return;
  }
  if (current.mode === 'AI') {
    const previous = db.prepare("SELECT provider_timestamp FROM messages WHERE conversation_id=? AND id<>? AND direction='inbound' ORDER BY rowid DESC LIMIT 1").get(id,msg.id) as {provider_timestamp:string|null}|undefined;
    if (previous?.provider_timestamp && Date.parse(msg.provider_timestamp || msg.created_at) - Date.parse(previous.provider_timestamp) > config.BOT_SESSION_TIMEOUT_MINUTES * 60000) {
      transitionConversation(id,'RETURN_MENU'); await reply(menu.welcome, 'MENU'); return;
    }
    if (!msg.text.trim()) { finish('PRESET'); return; }
     let answer:string;
     try { answer=await askAI(current, aiQuery,messageId); }
     catch (error) {
       if(error instanceof Error&&error.message==='AI rate limit'){await reply(menu.aiFlood,'PRESET');return;}
       db.prepare("UPDATE conversations SET menu_state='AI_ERROR' WHERE id=?").run(id);
       await reply(availableAgent()?menu.aiFailure:menu.aiFailureNoAgent, 'PRESET');return;
     }
     await reply(answer,'AI');
  }
}

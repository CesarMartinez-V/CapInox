import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { createHash, randomBytes, randomUUID, timingSafeEqual, scryptSync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config, getMenu, root } from './config.js';
import { db, event, getContact, getConversation, getMessage, persistInbound, incrementCounter } from './db.js';
import { normalizeProviderEvent } from './normalize.js';
import { enqueue, onChange, onMessageCreated, sendReply } from './router.js';
import { syncOwnedSubscription, listSubscriptions, expectedWebhookTarget, publicWebhookBase } from './provider.js';
import { startWorker, wakeJobs, retryJob, workerAlive } from './worker.js';
import { getAsset, mediaDirectory, retryMedia } from './media-service.js';
import { transitionConversation } from './state.js';
import { assignPending, assignmentChanged, reassignDisconnected } from './assignment.js';
import { isAvailable } from './availability.js';
import { resolveIncident } from './incidents.js';
import { dashboard } from './metrics.js';
import { startMonitor } from './monitor.js';
import { retryOutboundJob } from './outbound.js';
import { canView, canModify, hasPermission, rolePermissions, type Principal, type Permission } from './access.js';
import { nowUtc,monotonic,elapsed,mark,measure,traceForMessage,aggregateLatency } from './latency.js';
import { readRealtime,latestRealtimeId } from './realtime.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use((req,res,next)=>{
  if(req.path.startsWith('/api/')||req.path.startsWith('/webhooks/'))res.setHeader('Cache-Control','no-store');
  if(req.path.startsWith('/webhooks/messagesync/')||/^\/api\/conversations\/[^/]+\/messages$/.test(req.path)){
    res.locals.latencyReceivedAt=nowUtc();res.locals.latencyStarted=monotonic();
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: false } });
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEqual = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const buckets=new Map<string,{count:number;reset:number}>();
function allowedRequest(key:string,limit:number){
  const now=Date.now(),previous=buckets.get(key);
  const entry=previous&&previous.reset>now?previous:{count:0,reset:now+60000};
  entry.count++;buckets.set(key,entry);
  if(buckets.size>20000)for(const [id,value] of buckets)if(value.reset<=now)buckets.delete(id);
  return entry.count<=limit;
}
const cookieSecure = (req: Request) => req.secure || req.headers['x-forwarded-proto'] === 'https';
type Agent = Principal & { password_hash?: string|null };
function agentForToken(token: string | undefined): Agent | null {
  if (!token) return null;
   const row = db.prepare('SELECT a.id,a.username,a.role FROM sessions s JOIN agents a ON a.id=s.agent_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1').get(hash(token), Date.now());
  return (row as Agent | undefined) || null;
}
const getSession = (req: Request) => agentForToken(req.cookies?.cap_session);
function auth(req: Request, res: Response, next: NextFunction) {
  const agent = getSession(req);
  if (!agent) { res.status(401).json({ error: 'Inicia sesión' }); return; }
  res.locals.agent = agent;
  next();
}
function requirePermission(permission:Permission){return (_req:Request,res:Response,next:NextFunction)=>{
  if(!hasPermission(res.locals.agent as Agent,permission)){res.status(403).json({error:'Sin permiso'});return;}next();
};}
function conversationAccess(req:Request,res:Response,next:NextFunction){
  const c=getConversation(req.params.id as string);
  if(!c){res.status(404).end();return;}
  if(!canView(res.locals.agent as Agent,c)){res.status(403).json({error:'Sin acceso a esta conversación'});return;}
  res.locals.conversation=c;next();
}
io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie || '';
  const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('cap_session='))?.slice('cap_session='.length);
  const agent = agentForToken(token);
  if (!agent) return next(new Error('Unauthorized'));
  socket.data.agent=agent;
  next();
});
 io.on('connection', socket => {
    const id=(socket.data.agent as Agent).id;
    socket.join(`user:${id}`);
   const seen=()=>db.prepare("UPDATE agents SET status=CASE WHEN manual_status='ONLINE' THEN 'ONLINE' ELSE manual_status END,last_seen_at=? WHERE id=?").run(new Date().toISOString(),id);
   db.prepare('UPDATE agents SET connection_count=connection_count+1 WHERE id=?').run(id);
   seen();socket.emit('connected',{ok:true});
    socket.on('agent:heartbeat',()=>{seen();void assignPending();});
    socket.on('latency:ping',(_data:unknown,ack:unknown)=>{if(typeof ack==='function')(ack as (data:object)=>void)({serverTime:nowUtc()});});
    socket.on('latency:report',(data:unknown)=>{
      if(!data||typeof data!=='object')return;
      const v=data as {pingMs?:unknown;reconnects?:unknown;transport?:unknown};
      if(typeof v.transport!=='string'||!['websocket','polling'].includes(v.transport)||typeof v.pingMs!=='number'||!Number.isFinite(v.pingMs)||v.pingMs<0||v.pingMs>30000)return;
      const reconnects=typeof v.reconnects==='number'&&Number.isInteger(v.reconnects)&&v.reconnects>=0&&v.reconnects<100000?v.reconnects:0;
      db.prepare("INSERT INTO socket_latency(user_id,transport,ping_ms,reconnects) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET transport=excluded.transport,ping_ms=excluded.ping_ms,reconnects=excluded.reconnects,updated_at=datetime('now')").run(id,v.transport,v.pingMs,reconnects);
    });
   socket.on('disconnect',()=>{
     db.prepare('UPDATE agents SET connection_count=MAX(0,connection_count-1),last_seen_at=? WHERE id=?').run(new Date().toISOString(),id);
   });
  void assignPending();
});
function publish(id:string,type='conversation:changed'){
  const c=getConversation(id);if(!c)return;
  const summary=db.prepare(`SELECT v.id,v.contact_id,v.mode,v.intent,v.assigned_agent_id,v.status,v.last_message_at,v.created_at,v.updated_at,v.closed_at,v.disposition,v.priority,v.needs_reassignment,v.assignment_source,
    ct.name,ct.phone,ct.provider_contact_id,a.username AS assigned_to,
    (SELECT text FROM messages m WHERE m.conversation_id=v.id ORDER BY m.sequence DESC LIMIT 1) AS last_text
    FROM conversations v JOIN contacts ct ON ct.id=v.contact_id LEFT JOIN agents a ON a.id=v.assigned_agent_id WHERE v.id=?`).get(id) as Record<string,unknown>;
  for(const socket of io.sockets.sockets.values()){
    const actor=socket.data.agent as Agent;
    const current=db.prepare('SELECT role,active FROM agents WHERE id=?').get(actor.id) as {role:Agent['role'];active:number}|undefined;
    if(!current?.active){socket.disconnect(true);continue;}
    actor.role=current.role;
    if(canView(actor,c)){
      const unread=(db.prepare("SELECT COUNT(*) AS n FROM messages m WHERE m.conversation_id=? AND m.direction='inbound' AND m.sequence>COALESCE((SELECT last_read_sequence FROM conversation_reads WHERE user_id=? AND conversation_id=?),0)").get(id,actor.id,id) as {n:number}).n;
      socket.emit(type,{id,lastSequence:c.next_sequence,summary:{...summary,unread_count:unread}});
    }
  }
}
function emitMessage(messageId:string,eventType:'message:created'|'message:updated'|'media:ready'='message:created'){
  const m=db.prepare(`SELECT id,client_message_id,sequence,conversation_id,contact_id,direction,sender_type,route,message_type,text,media_url,mime_type,file_name,media_size,duration,latitude,longitude,delivery_status,provider_timestamp,created_at,storage_status,
    (SELECT COUNT(*) FROM media_assets a WHERE a.message_id=messages.id AND a.playable_path IS NOT NULL) AS playable_available,
    (SELECT correlation_id FROM message_latency t WHERE t.message_id=messages.id) AS correlation_id
    FROM messages WHERE id=?`).get(messageId) as Record<string,unknown>|undefined;
  if(!m)return;
  const c=getConversation(m.conversation_id as string);if(!c)return;
  let emitted=false;
  for(const socket of io.sockets.sockets.values()){
    const actor=socket.data.agent as Agent;
    const current=db.prepare('SELECT role,active FROM agents WHERE id=?').get(actor.id) as {role:Agent['role'];active:number}|undefined;
    if(!current?.active){socket.disconnect(true);continue;}
    actor.role=current.role;if(!canView(actor,c))continue;
    emitted=true;
    const began=monotonic();
    const event={message:m,conversationId:c.id,correlationId:m.correlation_id||null};
    socket.timeout(3000).emit(eventType,event,(error:Error|null,receipt?:{receivedAt?:string})=>{
      if(error)return;
      if(eventType==='message:created'&&traceForMessage(messageId)?.socket_ack_ms==null)measure(messageId,'socket_ack_ms',elapsed(began));
      if(typeof receipt?.receivedAt==='string'&&Number.isFinite(Date.parse(receipt.receivedAt)))mark(messageId,'browser_received_at',receipt.receivedAt);
    });
  }
  if(emitted&&eventType==='message:created')mark(messageId,'socket_emitted_at');
}
function audit(req:Request,actor:Agent,action:string,resourceId:string,before:object|null,after:object|null){
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,before_json,after_json,ip,user_agent) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),actor.id,action,'conversation',resourceId,before?JSON.stringify(before):null,after?JSON.stringify(after):null,req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
}
onChange(id => publish(id));
onMessageCreated(id=>emitMessage(id));
assignmentChanged((id,revoked)=>{publish(id);if(revoked)io.to(`user:${revoked}`).emit('inbox:refresh');});
let realtimeCursor=latestRealtimeId();
const realtimeTimer=setInterval(()=>{
  for(let batch=0;batch<4;batch++){
    const events=readRealtime(realtimeCursor);
    for(const e of events){realtimeCursor=e.id;if(e.kind==='conversation.changed')publish(e.conversation_id);else if(e.kind==='conversation.closed')publish(e.conversation_id,'conversation.closed');else if(e.message_id)emitMessage(e.message_id,e.kind==='message.created'?'message:created':e.kind==='media.ready'?'media:ready':'message:updated');}
    if(events.length<200)break;
  }
},100);
realtimeTimer.unref();
const presenceTimer=setInterval(()=>{
  const cutoff=new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString();
  db.prepare("UPDATE agents SET status='AWAY' WHERE status='ONLINE' AND (last_seen_at IS NULL OR last_seen_at<?)").run(cutoff);
  reassignDisconnected();
},30000);
presenceTimer.unref();

app.post('/api/login', (req, res) => {
  if(!allowedRequest(`login:${req.ip}`,10)){res.status(429).json({error:'Espera un momento antes de intentarlo de nuevo'});return;}
  const body = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
  if (!body.success || body.data.username.length>80 || body.data.password.length>200) {
    res.status(401).json({ error: 'Credenciales incorrectas' }); return;
  }
  let agent = db.prepare('SELECT id,username,role,password_hash FROM agents WHERE username=? AND active=1').get(body.data.username) as Agent | undefined;
  const valid = agent?.password_hash ? (() => {
    const [salt, digest] = agent.password_hash!.split(':');
    return Boolean(salt && digest) && timingSafeEqual(scryptSync(body.data.password,salt,32),Buffer.from(digest,'hex'));
  })() : Boolean(config.ADMIN_PASSWORD && safeEqual(body.data.username,config.ADMIN_USER) && safeEqual(body.data.password,config.ADMIN_PASSWORD));
  if (!valid) { res.status(401).json({error:'Credenciales incorrectas'}); return; }
  if (!agent) {
    const id = randomUUID(); db.prepare("INSERT INTO agents(id,username,name,role) VALUES (?,?,?,'SUPERADMIN')").run(id, body.data.username, 'Administrador');
    agent = { id, username: body.data.username,role:'SUPERADMIN' };
  }
  if (!agent.password_hash) {
    const salt = randomBytes(16).toString('hex');
    db.prepare('UPDATE agents SET password_hash=? WHERE id=?').run(`${salt}:${scryptSync(body.data.password,salt,32).toString('hex')}`,agent.id);
  }
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(hash(token), agent.id, Date.now() + 8 * 3600000);
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,ip,user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(),agent.id,'login','user',agent.id,req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
  res.cookie('cap_session', token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure(req), maxAge: 8 * 3600000, path: '/' });
  res.json({ agent:{id:agent.id,username:agent.username,role:agent.role,permissions:[...rolePermissions[agent.role]]} });
});
app.get('/api/me', auth, (_req, res) => {const a=res.locals.agent as Agent;res.json({agent:{...a,permissions:[...rolePermissions[a.role]]}});});
app.post('/api/logout', auth, (req, res) => {
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,ip,user_agent) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'logout','user',(res.locals.agent as Agent).id,req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(req.cookies.cap_session));
  res.clearCookie('cap_session', { path: '/' }); res.json({ ok: true });
});

app.post('/webhooks/messagesync/:secret', (req, res) => {
  if (!config.WEBHOOK_INGRESS_SECRET || config.WEBHOOK_INGRESS_SECRET.length < 32 || !safeEqual(req.params.secret as string, config.WEBHOOK_INGRESS_SECRET)) {
    res.status(404).end(); return;
  }
  let normalized;
  try { normalized = normalizeProviderEvent(req.body); }
  catch { res.status(400).json({ error: 'Invalid event' }); return; }
  const payload = (req.body?.payload && typeof req.body.payload === 'object') ? req.body.payload : {};
  if ((!req.body?.locationId&&!payload.locationId)|| (req.body?.locationId&&req.body.locationId!==config.GHL_LOCATION_ID) || (payload.locationId&&payload.locationId!==config.GHL_LOCATION_ID)) { res.status(202).json({ ignored: true }); return; }
  if (normalized.direction !== 'inbound') { res.status(202).json({ ignored: true }); return; }
  if (!normalized.messageId || !normalized.contactId) { res.status(202).json({ ignored: true }); return; }
  try {
    const validationAt=nowUtc();
    const started=monotonic();
    const correlationId=randomUUID();
    const item = persistInbound(normalized,{correlationId,serverReceivedAt:res.locals.latencyReceivedAt||validationAt,validationCompletedAt:validationAt,validationMs:typeof res.locals.latencyStarted==='number'?elapsed(res.locals.latencyStarted):0});
    if (!item) { incrementCounter('duplicate_events_total');res.json({ duplicate: true }); return; }
    mark(item.id,'db_persisted_at');measure(item.id,'db_persist_ms',elapsed(started));
    res.once('finish',()=>{mark(item.id,'http_ack_at');if(typeof res.locals.latencyStarted==='number')measure(item.id,'http_ack_ms',elapsed(res.locals.latencyStarted));});
     emitMessage(item.id);publish(item.conversationId);
    if(process.env.CAP_WORKER_EXTERNAL!=='true')wakeJobs();
    res.status(202).json({ accepted: true, correlationId });
  } catch (error) { logError('inbound_failed', error, normalized.messageId); res.status(500).json({ error: 'Failed to store event' }); }
});
function logError(label: string, err: unknown, messageId?: string | null) {
  // No raw request data, headers or provider response bodies in logs.
  console.error(JSON.stringify({ label, messageId: messageId?.slice(0, 8), error: err instanceof Error ? err.message.replace(/(Bearer\s+|sk-)[^\s]+/ig, '[redacted]') : 'unknown' }));
}

app.get('/api/conversations', auth, (req, res) => {
  const queryStarted=monotonic();
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '';
   const condition = filter === 'pending' ? " AND v.mode='HUMAN_PENDING'" : filter === 'active' ? " AND v.mode IN ('HUMAN_ACTIVE','CLOSING')" : filter === 'closed' ? " AND v.mode='CLOSED'" : filter === 'ai' ? " AND v.mode IN ('MENU','AI')" : filter === 'unread' ? " AND v.mode IN ('HUMAN_PENDING','HUMAN_ACTIVE','CLOSING') AND EXISTS(SELECT 1 FROM messages mi WHERE mi.conversation_id=v.id AND mi.direction='inbound' AND mi.sequence>COALESCE((SELECT last_read_sequence FROM conversation_reads WHERE user_id=@actor AND conversation_id=v.id),0))" : " AND v.mode IN ('HUMAN_PENDING','HUMAN_ACTIVE','CLOSING')";
  const cursor=typeof req.query.cursorTime==='string'&&typeof req.query.cursorId==='string'?{time:req.query.cursorTime.slice(0,50),id:req.query.cursorId.slice(0,100)}:null;
   const actor=res.locals.agent as Agent;
   const scope=" AND (@all=1 OR v.assigned_agent_id=@actor OR (v.mode='HUMAN_PENDING' AND v.assigned_agent_id IS NULL))";
   const list = db.prepare(`SELECT v.id,v.contact_id,v.mode,v.intent,v.assigned_agent_id,v.status,v.last_message_at,v.created_at,v.updated_at,v.closed_at,v.disposition,v.priority,v.needs_reassignment,v.assignment_source,c.name,c.phone,c.provider_contact_id,a.username AS assigned_to,
     (SELECT COUNT(*) FROM messages mi WHERE mi.conversation_id=v.id AND mi.direction='inbound' AND mi.sequence>COALESCE((SELECT last_read_sequence FROM conversation_reads WHERE user_id=@actor AND conversation_id=v.id),0)) AS unread_count,
    (SELECT text FROM messages m WHERE m.conversation_id=v.id ORDER BY m.rowid DESC LIMIT 1) AS last_text
    FROM conversations v JOIN contacts c ON c.id=v.contact_id LEFT JOIN agents a ON a.id=v.assigned_agent_id
     WHERE (c.name LIKE @search OR c.phone LIKE @search OR c.provider_contact_id LIKE @search OR v.disposition LIKE @search OR EXISTS(SELECT 1 FROM conversation_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.conversation_id=v.id AND t.name LIKE @search)) ${condition} ${scope}
       AND (@cursorTime IS NULL OR v.last_message_at<@cursorTime OR (v.last_message_at=@cursorTime AND v.id<@cursorId))
     ORDER BY v.last_message_at DESC,v.id DESC LIMIT 51`).all({search:`%${search}%`,all:hasPermission(actor,'conversation.view_all')?1:0,actor:actor.id,cursorTime:cursor?.time??null,cursorId:cursor?.id??null}) as Array<{id:string;last_message_at:string}>;
  const page=list.slice(0,50),last=page.at(-1);
  if(elapsed(queryStarted)>100)console.warn(JSON.stringify({event:'slow_query',query:'inbox_list',duration_ms:Math.round(elapsed(queryStarted))}));
  res.json({ conversations: page, nextCursor:list.length>50&&last?{time:last.last_message_at,id:last.id}:null });
});
app.get('/api/conversations/:id', auth, conversationAccess, (req, res) => {
  const conversation = getConversation(req.params.id as string);
  if (!conversation) { res.status(404).end(); return; }
  res.json({ conversation, contact: getContact(conversation.contact_id) });
});
// Directory is scoped to conversations the current agent may access; it never
// exposes contacts belonging exclusively to another agent.
app.get('/api/contacts',auth,(req,res)=>{
  const actor=res.locals.agent as Agent;
  const search=typeof req.query.search==='string'?req.query.search.slice(0,100).trim():'';
  const offset=Math.max(0,Math.min(10000,Number.parseInt(String(req.query.offset||'0'),10)||0));
  const rows=db.prepare(`SELECT c.id,c.name,c.phone,c.provider_contact_id,COUNT(v.id) AS conversation_count,MAX(v.last_message_at) AS last_interaction_at
    FROM contacts c JOIN conversations v ON v.contact_id=c.id
    WHERE (@all=1 OR v.assigned_agent_id=@actor OR (v.mode='HUMAN_PENDING' AND v.assigned_agent_id IS NULL))
      AND (c.name LIKE @search OR c.phone LIKE @search OR c.provider_contact_id LIKE @search)
    GROUP BY c.id ORDER BY last_interaction_at DESC,c.id DESC LIMIT 51 OFFSET @offset`).all({all:hasPermission(actor,'conversation.view_all')?1:0,actor:actor.id,search:`%${search}%`,offset}) as Array<{id:string}>;
  res.json({contacts:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null});
});
app.get('/api/contacts/:id',auth,(req,res)=>{
  const actor=res.locals.agent as Agent;
  const contact=db.prepare(`SELECT c.id,c.name,c.phone,c.provider_contact_id,COUNT(v.id) AS conversation_count,MAX(v.last_message_at) AS last_interaction_at
    FROM contacts c JOIN conversations v ON v.contact_id=c.id
    WHERE c.id=@id AND (@all=1 OR v.assigned_agent_id=@actor OR (v.mode='HUMAN_PENDING' AND v.assigned_agent_id IS NULL))
    GROUP BY c.id`).get({id:req.params.id,all:hasPermission(actor,'conversation.view_all')?1:0,actor:actor.id});
  if(!contact){res.status(404).json({error:'Contacto no disponible'});return;}
  res.json({contact});
});
app.get('/api/contacts/:id/history',auth,(req,res)=>{
  const actor=res.locals.agent as Agent;
  const contact=req.params.id as string;
  const scope=hasPermission(actor,'conversation.view_all')?1:0;
  const rows=db.prepare(`SELECT v.id,v.mode,v.created_at,v.closed_at,v.disposition,a.username AS assigned_to
    FROM conversations v LEFT JOIN agents a ON a.id=v.assigned_agent_id
     WHERE v.contact_id=@contact AND (@all=1 OR v.assigned_agent_id=@actor OR (v.mode='HUMAN_PENDING' AND v.assigned_agent_id IS NULL))
    ORDER BY v.created_at DESC,v.rowid DESC LIMIT 50`).all({contact,all:scope,actor:actor.id});
  if(!rows.length){res.status(403).json({error:'Sin acceso al historial'});return;}
  res.json({sessions:rows});
});
app.get('/api/conversations/:id/notes',auth,conversationAccess,(req,res)=>{
  res.json({notes:db.prepare('SELECT n.id,n.text,n.created_at,a.username AS author FROM conversation_notes n JOIN agents a ON a.id=n.actor_user_id WHERE n.conversation_id=? ORDER BY n.created_at DESC,n.rowid DESC LIMIT 100').all(req.params.id)});
});
app.post('/api/conversations/:id/notes',auth,conversationAccess,(req,res)=>{
  const c=res.locals.conversation as ReturnType<typeof getConversation>,actor=res.locals.agent as Agent;
  if(!c||!canModify(actor,c,'conversation.reply_own','conversation.reply_all')){res.status(403).end();return;}
  const input=z.object({text:z.string().trim().min(1).max(2000)}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Nota inválida'});return;}
  const id=randomUUID();db.prepare('INSERT INTO conversation_notes(id,conversation_id,actor_user_id,text) VALUES (?,?,?,?)').run(id,c.id,actor.id,input.data.text);
  audit(req,actor,'note_add',c.id,null,{noteId:id});publish(c.id);
  res.status(201).json({id});
});
app.get('/api/tags',auth,(_req,res)=>res.json({tags:db.prepare('SELECT id,name,color FROM tags WHERE active=1 ORDER BY name').all()}));
app.post('/api/tags',auth,requirePermission('settings.manage'),(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(40),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a6e3ce')}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Tag inválido'});return;}
  const id=randomUUID();try{db.prepare('INSERT INTO tags(id,name,color) VALUES (?,?,?)').run(id,input.data.name,input.data.color);res.status(201).json({id});}
  catch(err){if(err instanceof Error&&err.message.includes('UNIQUE')){res.status(409).json({error:'Tag ya existe'});return;}throw err;}
});
app.get('/api/conversations/:id/tags',auth,conversationAccess,(req,res)=>res.json({tags:db.prepare('SELECT t.id,t.name,t.color FROM tags t JOIN conversation_tags ct ON ct.tag_id=t.id WHERE ct.conversation_id=? ORDER BY t.name').all(req.params.id)}));
app.post('/api/conversations/:id/tags',auth,conversationAccess,(req,res)=>{
  const c=res.locals.conversation as ReturnType<typeof getConversation>,actor=res.locals.agent as Agent;
  if(!c||!canModify(actor,c,'conversation.reply_own','conversation.reply_all')){res.status(403).end();return;}
  const input=z.object({tagId:z.string().min(1).max(80)}).safeParse(req.body);
  if(!input.success||!db.prepare('SELECT 1 FROM tags WHERE id=? AND active=1').get(input.data.tagId)){res.status(400).json({error:'Tag no disponible'});return;}
  db.prepare('INSERT OR IGNORE INTO conversation_tags(conversation_id,tag_id) VALUES (?,?)').run(c.id,input.data.tagId);
  audit(req,actor,'tag_add',c.id,null,{tagId:input.data.tagId});publish(c.id);res.json({ok:true});
});
app.get('/api/conversations/:id/messages', auth, conversationAccess, (req, res) => {
  const queryStarted=monotonic();
  if (!getConversation(req.params.id as string)) { res.status(404).end(); return; }
  const after=typeof req.query.afterSequence==='string'?Number(req.query.afterSequence):null;
  const before=typeof req.query.beforeSequence==='string'?Number(req.query.beforeSequence):null;
  if ((after!==null&&!Number.isSafeInteger(after))||(before!==null&&!Number.isSafeInteger(before))||(after!==null&&before!==null)) {res.status(400).json({error:'Cursor inválido'});return;}
    const fields='id,client_message_id,provider_message_id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text,media_url,mime_type,file_name,media_size,duration,latitude,longitude,delivery_status,storage_status,provider_timestamp,created_at,(SELECT COUNT(*) FROM media_assets a WHERE a.message_id=messages.id AND a.playable_path IS NOT NULL) AS playable_available,(SELECT correlation_id FROM message_latency t WHERE t.message_id=messages.id) AS correlation_id';
  const query=after!==null?`SELECT ${fields} FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence ASC LIMIT 100`
    :`SELECT ${fields} FROM messages WHERE conversation_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT 101`;
  const rows=(after!==null?db.prepare(query).all(req.params.id,after):db.prepare(query).all(req.params.id,before,before)) as Array<{sequence:number}>;
  const hasMore=after===null&&rows.length>100;
  const messages=after!==null?rows:rows.slice(0,100).reverse();
  if(elapsed(queryStarted)>100)console.warn(JSON.stringify({event:'slow_query',query:'message_page',duration_ms:Math.round(elapsed(queryStarted))}));
  res.json({messages,hasMore,nextBeforeSequence:hasMore?messages[0]?.sequence:null});
});
app.post('/api/conversations/:id/read', auth, conversationAccess, (req,res) => {
  const id=req.params.id as string;
  if (!getConversation(id)) { res.status(404).end(); return; }
   db.prepare("INSERT INTO conversation_reads(user_id,conversation_id,last_read_sequence) VALUES (?,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_read_sequence=MAX(last_read_sequence,excluded.last_read_sequence),updated_at=datetime('now')").run((res.locals.agent as Agent).id,id,getConversation(id)!.next_sequence);
   io.to(`user:${(res.locals.agent as Agent).id}`).emit('inbox:refresh');res.json({ok:true});
});
app.post('/api/conversations/:id/claim', auth, requirePermission('conversation.claim'), conversationAccess, async (req, res) => {
  const id = req.params.id as string;
  const result = transitionConversation(id,'CLAIM',{agentId:(res.locals.agent as Agent).id});
   if (!result.ok) { res.status(409).json({ error: result.reason }); return; }
   audit(req,res.locals.agent as Agent,'claim',id,null,{agentId:(res.locals.agent as Agent).id});
   publish(id);
  try { await enqueue(id, () => sendReply(getConversation(id)!, getMenu().claim, 'human', 'HUMAN').then(() => {})); res.json({ ok: true }); }
  catch (err) { logError('claim_send_failed', err); res.status(502).json({ error: 'Tomado; saludo no entregado' }); }
});
app.get('/api/agents',auth,(_req,res)=>{
  const cutoff=new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString();
  res.json({agents:db.prepare("SELECT id,username,name,CASE WHEN connection_count=0 OR last_seen_at IS NULL OR last_seen_at<? THEN 'OFFLINE' WHEN status='ONLINE' AND active_chat_count>=max_active_chats THEN 'BUSY' ELSE status END AS status,manual_status,connection_count,active_chat_count,max_active_chats FROM agents WHERE active=1 ORDER BY username").all(cutoff)});
});
app.post('/api/agents/me/status',auth,(req,res)=>{
  const input=z.object({status:z.enum(['ONLINE','AWAY','BUSY','OFFLINE'])}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Estado inválido'});return;}
  db.prepare('UPDATE agents SET manual_status=?,status=? WHERE id=?').run(input.data.status,input.data.status,(res.locals.agent as Agent).id);
  if(input.data.status==='ONLINE')void assignPending(true);
  res.json({ok:true,status:input.data.status});
});
app.get('/api/users',auth,requirePermission('users.manage'),(_req,res)=>{
  const users=db.prepare('SELECT id,username,name,role,active,manual_status,status,connection_count,max_active_chats,active_chat_count,created_at FROM agents ORDER BY username').all();
  res.json({users});
});
app.post('/api/users',auth,requirePermission('users.manage'),(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(100),username:z.string().trim().toLowerCase().regex(/^[a-z0-9._@-]{3,80}$/),password:z.string().min(12).max(200),role:z.enum(['AGENT','ADMIN','SUPERADMIN']),maxActiveChats:z.number().int().min(1).max(100).default(5)}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Usuario, contraseña (mínimo 12 caracteres) o capacidad inválidos'});return;}
  const id=randomUUID(),salt=randomBytes(16).toString('hex'),digest=scryptSync(input.data.password,salt,32).toString('hex');
  try{
    db.prepare("INSERT INTO agents(id,username,name,role,password_hash,max_active_chats,status) VALUES (?,?,?,?,?,?,'OFFLINE')").run(id,input.data.username,input.data.name,input.data.role,`${salt}:${digest}`,input.data.maxActiveChats);
    db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,after_json,ip,user_agent) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'user_create','user',id,JSON.stringify({role:input.data.role,username:input.data.username}),req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
    res.status(201).json({id,username:input.data.username,role:input.data.role});
  }catch(err){if(err instanceof Error&&err.message.includes('UNIQUE')){res.status(409).json({error:'Usuario ya existe'});return;}throw err;}
});
app.patch('/api/users/:id',auth,requirePermission('users.manage'),(req,res)=>{
  const id=req.params.id as string;
  const input=z.object({name:z.string().trim().min(2).max(100).optional(),role:z.enum(['AGENT','ADMIN','SUPERADMIN']).optional(),active:z.boolean().optional(),maxActiveChats:z.number().int().min(1).max(100).optional(),deactivateHandling:z.union([z.literal('QUEUE'),z.string().uuid()]).optional()}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Cambio de usuario inválido'});return;}
  const previous=db.prepare('SELECT id,role,active,name,max_active_chats FROM agents WHERE id=?').get(id) as {id:string;role:string;active:number;name:string;max_active_chats:number}|undefined;
  if(!previous){res.status(404).end();return;}
  if(previous.role==='SUPERADMIN'&&(input.data.role&&input.data.role!=='SUPERADMIN'||input.data.active===false)){
    const count=(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role='SUPERADMIN' AND active=1").get() as {n:number}).n;
    if(count<=1){res.status(409).json({error:'Debe quedar al menos un superadministrador activo'});return;}
  }
  const chats=db.prepare("SELECT id FROM conversations WHERE assigned_agent_id=? AND mode IN ('HUMAN_ACTIVE','CLOSING')").all(id) as Array<{id:string}>;
  if(input.data.active===false&&chats.length&&!input.data.deactivateHandling){res.status(409).json({error:`El agente tiene ${chats.length} chats activos. Elige destino o cola.`,activeChats:chats.length});return;}
  if(chats.some(c=>(getConversation(c.id)?.mode==='CLOSING'))){res.status(409).json({error:'Espera a que termine el cierre en curso'});return;}
  const destination=input.data.deactivateHandling&&input.data.deactivateHandling!=='QUEUE'?input.data.deactivateHandling:null;
  if(destination){
    if(destination===id||!isAvailable(destination)){res.status(409).json({error:'Destino no está disponible'});return;}
    const agent=db.prepare('SELECT max_active_chats FROM agents WHERE id=?').get(destination) as {max_active_chats:number};
    const load=(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE'").get(destination) as {n:number}).n;
    if(agent.max_active_chats-load<chats.length){res.status(409).json({error:'Destino no tiene capacidad para todos los chats'});return;}
  }
  db.transaction(()=>{
    for(const chat of input.data.active===false?chats:[]){
      db.prepare("UPDATE conversations SET assigned_agent_id=?,mode=?,assignment_source='ADMIN',needs_reassignment=0,version=version+1 WHERE id=? AND assigned_agent_id=?").run(destination,destination?'HUMAN_ACTIVE':'HUMAN_PENDING',chat.id,id);
      event(chat.id,'conversation_transferred',{fromAgent:id,toAgent:destination,reason:'user_deactivated',actor:(res.locals.agent as Agent).id});
    }
    db.prepare('UPDATE agents SET name=COALESCE(?,name),role=COALESCE(?,role),active=COALESCE(?,active),max_active_chats=COALESCE(?,max_active_chats),active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode=\'HUMAN_ACTIVE\') WHERE id=?').run(input.data.name??null,input.data.role??null,input.data.active===undefined?null:Number(input.data.active),input.data.maxActiveChats??null,id,id);
    if(destination)db.prepare("UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE') WHERE id=?").run(destination,destination);
    if(input.data.active===false)db.prepare('DELETE FROM sessions WHERE agent_id=?').run(id);
    db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,before_json,after_json,ip,user_agent) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'user_update','user',id,JSON.stringify(previous),JSON.stringify({role:input.data.role,active:input.data.active,maxActiveChats:input.data.maxActiveChats,deactivateHandling:input.data.deactivateHandling}),req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
  })();
  for(const chat of chats)publish(chat.id);
  if(input.data.active===false)for(const socket of io.sockets.sockets.values())if((socket.data.agent as Agent).id===id)socket.disconnect(true);
  res.json({ok:true});
});
app.post('/api/conversations/:id/transfer',auth,conversationAccess,(req,res)=>{
  const actor=res.locals.agent as Agent,c=res.locals.conversation as ReturnType<typeof getConversation>;
  if(!c||!canModify(actor,c,'conversation.transfer_own','conversation.transfer_all')){res.status(403).end();return;}
  const input=z.object({toAgentId:z.string().uuid().nullable(),reason:z.string().trim().max(500).default('')}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Destino o motivo inválido'});return;}
  const result=db.transaction(()=>{
    const current=getConversation(c.id);
    if(!current||current.mode!=='HUMAN_ACTIVE'||current.assigned_agent_id!==c.assigned_agent_id||current.version!==c.version)return false;
    if(input.data.toAgentId===current.assigned_agent_id)return false;
    if(input.data.toAgentId){
      const agent=db.prepare('SELECT active,status,max_active_chats FROM agents WHERE id=?').get(input.data.toAgentId) as {active:number;status:string;max_active_chats:number}|undefined;
      const count=(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE'").get(input.data.toAgentId) as {n:number}).n;
      if(!agent?.active||!isAvailable(input.data.toAgentId)||count>=agent.max_active_chats)return false;
    }
    const update=db.prepare("UPDATE conversations SET assigned_agent_id=?,mode=?,handoff_at=CASE WHEN ? IS NULL THEN datetime('now') ELSE handoff_at END,assigned_at=CASE WHEN ? IS NULL THEN assigned_at ELSE datetime('now') END,assignment_source='TRANSFER',needs_reassignment=0,version=version+1,updated_at=datetime('now') WHERE id=? AND mode='HUMAN_ACTIVE' AND assigned_agent_id=? AND version=?")
      .run(input.data.toAgentId,input.data.toAgentId?'HUMAN_ACTIVE':'HUMAN_PENDING',input.data.toAgentId,input.data.toAgentId,c.id,current.assigned_agent_id,current.version);
    if(!update.changes)return false;
    for(const id of [current.assigned_agent_id,input.data.toAgentId].filter(Boolean))db.prepare("UPDATE agents SET active_chat_count=(SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=? AND mode='HUMAN_ACTIVE'),last_assigned_at=datetime('now') WHERE id=?").run(id,id);
    event(c.id,'conversation_transferred',{fromAgent:current.assigned_agent_id,toAgent:input.data.toAgentId,reason:input.data.reason,actor:actor.id});
    audit(req,actor,'transfer',c.id,{agentId:current.assigned_agent_id},{agentId:input.data.toAgentId,reason:input.data.reason});
    return true;
  })();
  if(!result){res.status(409).json({error:'La conversación cambió o el destino no está disponible'});return;}
  publish(c.id);io.to(`user:${c.assigned_agent_id}`).emit('inbox:refresh');res.json({ok:true});
});
app.post('/api/conversations/:id/return-to-bot', auth, conversationAccess, async (req, res) => {
   const id = req.params.id as string, c = getConversation(id);
   if (!c) { res.status(404).end(); return; }
   if(c.mode==='HUMAN_ACTIVE'&&!canModify(res.locals.agent as Agent,c,'conversation.reply_own','conversation.reply_all')){res.status(403).end();return;}
  if (c.mode !== 'HUMAN_ACTIVE' && c.mode !== 'HUMAN_PENDING') { res.status(409).json({ error: 'No está en modo humano' }); return; }
  const result=transitionConversation(id,'RETURN_MENU');
  if(!result.ok){res.status(409).json({error:result.reason});return;}
  audit(req,res.locals.agent as Agent,'return_to_bot',id,{mode:c.mode},{mode:'MENU'});
  void assignPending();
   publish(id);
  try { await enqueue(id, () => sendReply(getConversation(id)!, getMenu().returnToBot, 'bot', 'MENU').then(() => {})); res.json({ ok: true }); }
  catch (err) { logError('return_send_failed', err); res.status(502).json({ error: 'Estado cambiado; mensaje no entregado' }); }
});
app.post('/api/conversations/:id/close', auth, conversationAccess, async (req, res) => {
  const id = req.params.id as string;
  const c=getConversation(id);
  if (!c) { res.status(404).end(); return; }
  if(!canModify(res.locals.agent as Agent,c,'conversation.close_own','conversation.close_all')){res.status(403).end();return;}
  if(c.mode==='CLOSING'){res.status(202).json({ok:true,status:'closing'});return;}
  if(c.mode!=='HUMAN_ACTIVE'){res.status(409).json({error:'Solo puede cerrarse un chat humano activo'});return;}
  const closing=z.object({disposition:z.enum(['SALE_COMPLETED','CONSULT_RESOLVED','QUOTE_SENT','FOLLOW_UP','NO_RESPONSE','NO_SALE','WRONG_NUMBER','SPAM','GENERAL_CLOSE','DUPLICATE','OTHER']),note:z.string().max(1000).default(''),saleAmount:z.number().nonnegative().nullable().optional(),saleReference:z.string().trim().max(100).optional(),followUpAt:z.string().datetime({offset:true}).nullable().optional(),force:z.boolean().default(false)}).safeParse(req.body);
  if(!closing.success){res.status(400).json({error:'Selecciona el resultado del chat'});return;}
  try {
    await enqueue(id,async()=>{
      const clientId=`close:${id}`;
      const previous=db.prepare('SELECT * FROM messages WHERE client_message_id=?').get(clientId) as ReturnType<typeof getMessage>;
      if(closing.data.force&&(!hasPermission(res.locals.agent as Agent,'conversation.close_all')||!previous||!['failed','unknown'].includes(previous.delivery_status||'')))throw new Error('Cierre forzado no autorizado o sin fallo confirmado');
      if(!closing.data.force&&previous?.delivery_status==='unknown')throw new Error('Entrega ambigua; requiere reconciliación o cierre autorizado');
      const started=transitionConversation(id,'BEGIN_CLOSE');
      if(!started.ok)throw new Error(started.reason);
      try {
        db.prepare('UPDATE conversations SET disposition=?,closed_by=?,close_note=?,sale_amount=?,sale_reference=?,follow_up_at=?,final_assignee_id=? WHERE id=?').run(closing.data.disposition,(res.locals.agent as Agent).id,closing.data.note,closing.data.saleAmount??null,closing.data.saleReference||null,closing.data.followUpAt||null,c.assigned_agent_id,id);
        audit(req,res.locals.agent as Agent,'close_requested',id,{mode:'HUMAN_ACTIVE'},{mode:'CLOSING',disposition:closing.data.disposition});
        if(closing.data.force||previous?.delivery_status==='sent'){
          if(closing.data.force)audit(req,res.locals.agent as Agent,'force_close',id,{deliveryStatus:previous?.delivery_status},{disposition:closing.data.disposition});
          const done=transitionConversation(id,'CONFIRM_CLOSE');if(!done.ok)throw new Error(done.reason);
          audit(req,res.locals.agent as Agent,'close',id,{mode:'CLOSING'},{mode:'CLOSED',disposition:closing.data.disposition});
          publish(id,'conversation.closed');publish(id);void assignPending(true);return;
        }
        if(previous?.delivery_status==='failed'){
          const job=db.prepare('SELECT id FROM outbound_jobs WHERE message_id=?').get(previous.id) as {id:string}|undefined;
          if(!job||!retryOutboundJob(job.id))throw new Error('Cierre no reintentable');
        }else if(!previous)await sendReply(getConversation(id)!,getMenu().close,'human','HUMAN',[],undefined,undefined,undefined,clientId);
        publish(id);
      }catch(err){transitionConversation(id,'CLOSE_FAILED');publish(id);throw err;}
    });
    res.status(202).json({ok:true,status:getConversation(id)?.mode==='CLOSED'?'closed':'closing'});
  }catch(err){logError('close_queue_failed',err);res.status(409).json({error:'Cierre no confirmado; conversación disponible para reintentar o reconciliar'});}
});

const uploadDir = resolve(root, 'uploads'); mkdirSync(uploadDir, { recursive: true });
const allowedMime = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const extensions: Record<string,string> = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf','application/msword':'.doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.ms-excel':'.xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'};
const upload = multer({ storage: multer.diskStorage({destination: uploadDir,filename: (_req,file,cb) => cb(null,`${randomUUID()}${extensions[file.mimetype] || ''}`)}), limits: {fileSize:config.MAX_UPLOAD_MB*1024*1024,files:1}, fileFilter: (_req,file,cb) => cb(null, allowedMime.has(file.mimetype) && extname(file.originalname).toLowerCase() === extensions[file.mimetype]) });
app.post('/api/conversations/:id/messages', auth, conversationAccess, upload.single('file'), async (req, res) => {
  const id = req.params.id as string, c = getConversation(id);
  if(!allowedRequest(`send:${(res.locals.agent as Agent).id}:${id}`,60)){res.status(429).json({error:'Demasiados mensajes; espera un momento'});return;}
  if (!c) { res.status(404).end(); return; }
   if (c.mode !== 'HUMAN_ACTIVE' || !canModify(res.locals.agent as Agent,c,'conversation.reply_own','conversation.reply_all')) { res.status(403).json({ error: 'Sin permiso de respuesta' }); return; }
   const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 10000) : '';
   const clientCreatedAt=typeof req.body.clientCreatedAt==='string'&&Number.isFinite(Date.parse(req.body.clientCreatedAt))?req.body.clientCreatedAt:undefined;
  const clientId=typeof req.body.clientRequestId==='string'&&/^[a-f0-9-]{36}$/i.test(req.body.clientRequestId)?req.body.clientRequestId:null;
  if(!clientId){res.status(400).json({error:'clientRequestId UUID requerido'});return;}
  const duplicate=db.prepare('SELECT id,conversation_id,delivery_status FROM messages WHERE client_message_id=?').get(clientId) as {id:string;conversation_id:string;delivery_status:string}|undefined;
  if(duplicate){if(req.file)unlinkSync(req.file.path);if(duplicate.conversation_id!==id){res.status(409).json({error:'ID de envío ya utilizado'});return;}res.status(duplicate.delivery_status==='failed'?409:200).json(duplicate.delivery_status==='failed'?{error:'Envío anterior falló; usa Reintentar',messageId:duplicate.id}:{ok:true,messageId:duplicate.id,status:duplicate.delivery_status});return;}
  if (!text && !req.file) { res.status(400).json({ error: 'Texto o archivo requerido' }); return; }
   let mediaOrigin='';try{mediaOrigin=publicWebhookBase();}catch{}
   if (req.file && !mediaOrigin) { res.status(503).json({ error: 'URL pública estable requerida para adjuntos' }); return; }
   const url = req.file ? `${mediaOrigin}/media/${req.file.filename}` : '';
  try {
    let messageId = '';
     await enqueue(id, async () => { messageId = await sendReply(getConversation(id)!, text, 'human', 'HUMAN', url ? [url] : [], req.file?.mimetype, req.file?.originalname,undefined,clientId,clientCreatedAt,res.locals.latencyReceivedAt); });
     measure(messageId,'api_accept_ms',typeof res.locals.latencyStarted==='number'?elapsed(res.locals.latencyStarted):0);
     if(clientCreatedAt){const wall=Date.now()-Date.parse(clientCreatedAt);if(wall>=0&&wall<600000)measure(messageId,'client_to_api_ms',wall);}
     res.once('finish',()=>{mark(messageId,'http_ack_at');if(typeof res.locals.latencyStarted==='number')measure(messageId,'http_ack_ms',elapsed(res.locals.latencyStarted));});
     audit(req,res.locals.agent as Agent,'reply',id,null,{messageId});
     res.status(202).json({ ok: true, messageId,status:'pending',correlationId:traceForMessage(messageId)?.correlation_id||null });
  } catch (err) { logError('human_send_failed', err); res.status(502).json({ error: 'No entregado; consulta el estado del mensaje' }); }
});
app.post('/api/conversations/:id/messages/:messageId/retry', auth, conversationAccess, async (req,res) => {
  const id=req.params.id as string,c=getConversation(id), m=getMessage(req.params.messageId as string);
  if(!c||!m||m.conversation_id!==id){res.status(404).end();return;}
   if(c.mode!=='HUMAN_ACTIVE'||!canModify(res.locals.agent as Agent,c,'conversation.reply_own','conversation.reply_all')||m.sender_type!=='human'||m.delivery_status!=='failed'){
    res.status(409).json({error:'Mensaje no reintentable'});return;
  }
  const job=db.prepare('SELECT id FROM outbound_jobs WHERE message_id=?').get(m.id) as {id:string}|undefined;
  if(!job||!retryOutboundJob(job.id)){res.status(409).json({error:'Mensaje no reintentable'});return;}
   publish(id);
   publish(id);res.status(202).json({ok:true,status:'pending'});
});
app.get('/api/media/:id',auth,(req,res)=>{
  const id=req.params.id as string;
  if(!/^[a-f0-9-]{36}$/i.test(id)){res.status(404).end();return;}
  const asset=getAsset(id);
  if(!asset||asset.storage_status!=='READY'){res.status(404).json({error:'Archivo no disponible'});return;}
   const scope=db.prepare('SELECT v.* FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE m.id=?').get(asset.message_id) as ReturnType<typeof getConversation>;
   if(!scope||!canView(res.locals.agent as Agent,scope)||!['HUMAN_PENDING','HUMAN_ACTIVE','CLOSING','CLOSED'].includes(scope.mode)){res.status(403).end();return;}
  const playable=req.query.playable==='1'&&asset.playable_path;
  const thumbnail=req.query.thumbnail==='1'&&asset.mime_type?.startsWith('image/')&&asset.thumbnail_path;
  const name=playable?asset.playable_path:thumbnail?asset.thumbnail_path:asset.storage_path;
  if(!name||!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(name)){res.status(404).end();return;}
  const path=resolve(mediaDirectory,name);
  if(!existsSync(path)){res.status(404).end();return;}
  const mime=playable?'audio/mpeg':thumbnail?'image/jpeg':asset.mime_type||'application/octet-stream';
  res.setHeader('Content-Type',mime);
  res.setHeader('Content-Disposition',/^(image|audio|video)\//.test(mime)?'inline':'attachment');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','private, max-age=300');
  res.sendFile(path);
});
app.post('/api/conversations/:id/media/:messageId/retry',auth,conversationAccess,async(req,res)=>{
  const m=getMessage(req.params.messageId as string);
  const c=getConversation(req.params.id as string);
  if(!m||!c||m.conversation_id!==c.id||!['HUMAN_PENDING','HUMAN_ACTIVE','CLOSED'].includes(c.mode)){res.status(404).end();return;}
  await retryMedia(m.id);
  const status=db.prepare('SELECT storage_status FROM media_assets WHERE message_id=? LIMIT 1').get(m.id) as {storage_status:string}|undefined;
   publish(c.id);
  res.json({status:status?.storage_status||'unknown'});
});
app.get('/media/:filename', (req, res) => {
  const name = req.params.filename as string;
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|gif|webp|pdf|docx?|xlsx?)$/.test(name)) { res.status(404).end(); return; }
  const path = resolve(uploadDir, name);
  if (!existsSync(path)) { res.status(404).end(); return; }
  res.setHeader('Content-Disposition', 'attachment'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(path);
});
app.get('/api/menu', auth, (_req,res) => res.json(getMenu()));
app.put('/api/menu', auth, requirePermission('settings.manage'), (req,res) => {
  const current = getMenu();
   const data = z.object({ welcome:z.string().min(1),invalid:z.string().min(1),options:z.record(z.string(),z.object({intent:z.string(),reply:z.string().min(1)})),claim:z.string(),noAgent:z.string().min(1),returnToBot:z.string(),close:z.string().min(1),image:z.string(),audio:z.string(),video:z.string(),aiFailure:z.string(),aiFailureNoAgent:z.string(),aiFlood:z.string(),quickReplies:z.array(z.string()) }).safeParse({ ...current, ...req.body });
  if (!data.success) { res.status(400).json({error:'Menú inválido'}); return; }
   writeFileSync(resolve(root,'config/menu.json'),JSON.stringify(data.data,null,2),'utf8');
   db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,ip,user_agent) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'settings_menu_update','settings','menu',req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
   io.emit('menu:changed'); res.json({ok:true});
});
function readyState(){
  let database=false;
  try{database=Boolean(db.prepare('SELECT 1 AS ok').get());}catch{}
  const worker=workerAlive();
  const configured=Boolean(config.MESSAGESYNC_API_KEY&&config.GHL_LOCATION_ID&&config.WEBHOOK_INGRESS_SECRET?.length>=32&&config.N8N_AI_WEBHOOK_URL);
  return {database,worker,configured,ready:database&&worker&&configured};
}
app.get('/health/live',(_req,res)=>res.json({backend:'online'}));
app.get('/health/ready',(_req,res)=>{const state=readyState();res.status(state.ready?200:503).json(state);});
app.get('/api/health', auth, requirePermission('audit.view'), async (_req,res) => {
  const ready=readyState();
  const check=async(url:string)=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});return r.ok?'online':'offline';}catch{return 'offline';}};
  let origin='';let target='';try{origin=publicWebhookBase();target=expectedWebhookTarget(origin);}catch{}
  const [subscriptions,tunnel,n8n]=await Promise.all([
    listSubscriptions().catch(()=>null),
    origin?check(`${origin}/health/live`):Promise.resolve('offline'),
    config.N8N_AI_WEBHOOK_URL?check(new URL('/',config.N8N_AI_WEBHOOK_URL).href):Promise.resolve('offline'),
  ]);
  const own=subscriptions?.filter(s=>s.description==='web-demo-human-console')||[];
  const matched=Boolean(target&&own.length===1&&own[0].targetUrl===target);
  const jobs=db.prepare("SELECT SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed FROM jobs").get() as {pending:number|null;failed:number|null};
  const ai=db.prepare("SELECT event_type FROM conversation_events WHERE event_type IN ('ai_succeeded','ai_failed') ORDER BY rowid DESC LIMIT 1").get() as {event_type:string}|undefined;
  const success=db.prepare("SELECT MAX(created_at) AS last_success FROM conversation_events WHERE event_type='ai_succeeded'").get() as {last_success:string|null};
  const recentSuccess=Boolean(success.last_success&&Date.now()-Date.parse(success.last_success.replace(' ','T')+'Z')<3600000);
  res.json({backend:'online',database:ready.database?'online':'offline',worker:ready.worker?'online':'offline',messagesync:subscriptions?'online':'offline',messagesyncWebhook:matched?'online':'offline',n8nTransport:n8n==='online'?'reachable':'offline',aiEngine:ai?.event_type==='ai_failed'?'failing':recentSuccess?'healthy':'stale',aiLastSuccess:success.last_success,socket:'online',tunnel,jobsPending:jobs.pending||0,jobsFailed:jobs.failed||0});
});
app.post('/api/subscription/register', auth, requirePermission('settings.manage'), async (_req,res) => {
   try { const result=await syncOwnedSubscription(publicWebhookBase()); res.json(result); }
  catch (err) { logError('subscription_failed',err); res.status(502).json({error:'No se pudo registrar'}); }
});
app.get('/api/subscription/status', auth, requirePermission('audit.view'), async (_req,res) => {
   try { const list=await listSubscriptions();let target='';try{target=expectedWebhookTarget();}catch{}res.json({ count:list.length, match:Boolean(target&&list.some(s=>s.targetUrl===target)) }); }
  catch (err) { logError('subscription_status_failed',err); res.status(502).json({error:'No se pudo consultar MessageSync'}); }
});
app.get('/api/metrics', auth, requirePermission('metrics.view_all'), (_req,res) => {
  const counts = db.prepare(`SELECT COUNT(*) AS total_messages,
    COALESCE(SUM(CASE WHEN route='MENU' THEN 1 ELSE 0 END),0) AS menu_messages,
    COALESCE(SUM(CASE WHEN route='PRESET' THEN 1 ELSE 0 END),0) AS preset_messages,
    COALESCE(SUM(CASE WHEN route='AI' THEN 1 ELSE 0 END),0) AS ai_messages,
    COALESCE(SUM(CASE WHEN route='HUMAN' THEN 1 ELSE 0 END),0) AS human_messages FROM messages`).get();
  const calls = db.prepare("SELECT COUNT(*) AS n8n_calls, COALESCE(SUM(CASE WHEN json_extract(data,'$.mode') IN ('HUMAN_PENDING','HUMAN_ACTIVE') THEN 1 ELSE 0 END),0) AS n8n_calls_during_human FROM conversation_events WHERE event_type='n8n_called'").get();
  const handoffs = db.prepare("SELECT COUNT(*) AS handoffs FROM conversation_events WHERE event_type='handoff_requested'").get();
  const totals=db.prepare(`SELECT
    SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS inbound_total,
    SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) AS outbound_total,
    SUM(CASE WHEN message_type IN ('image','audio','video','document','sticker') THEN 1 ELSE 0 END) AS media_total,
    SUM(CASE WHEN delivery_status='failed' THEN 1 ELSE 0 END) AS failed_messages_total
    FROM messages`).get();
  const invalid=(db.prepare('SELECT SUM(invalid_menu_attempts) AS invalid_menu_total FROM conversations').get() as {invalid_menu_total:number|null}).invalid_menu_total||0;
  const failed=(db.prepare("SELECT COUNT(*) AS ai_failures_total FROM conversation_events WHERE event_type='ai_failed'").get() as {ai_failures_total:number}).ai_failures_total;
  const duplicate=(db.prepare("SELECT value FROM metrics_counters WHERE name='duplicate_events_total'").get() as {value:number}|undefined)?.value||0;
  const jobFailures=(db.prepare("SELECT COUNT(*) AS failed_jobs FROM jobs WHERE status='FAILED'").get() as {failed_jobs:number}).failed_jobs;
  res.json({ ...counts as object, ...calls as object, ...handoffs as object, ...totals as object,invalid_menu_total:invalid,ai_failures_total:failed,duplicate_events_total:duplicate,failed_jobs:jobFailures });
});
app.get('/api/metrics/dashboard',auth,requirePermission('metrics.view_all'),(req,res)=>{
  const today=new Date().toISOString().slice(0,10);
  const input=z.object({from:z.iso.date().optional(),to:z.iso.date().optional(),agentId:z.string().uuid().optional()}).safeParse(req.query);
  if(!input.success){res.status(400).json({error:'Rango o agente inválido'});return;}
  const from=input.data.from||today,to=input.data.to||new Date(Date.now()+86400000).toISOString().slice(0,10);
  if(from>=to){res.status(400).json({error:'El rango debe ser creciente'});return;}
  res.json(dashboard(`${from} 00:00:00`,`${to} 00:00:00`,input.data.agentId||null));
});
app.get('/api/jobs/failed',auth,requirePermission('diagnostics.view'),(_req,res)=>{
  const jobs=db.prepare("SELECT id,conversation_id,attempt_count,error,updated_at FROM jobs WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100").all();
  res.json({jobs});
});
app.get('/api/outbound/jobs',auth,requirePermission('diagnostics.view'),(_req,res)=>{
  const jobs=db.prepare("SELECT j.id,j.message_id,j.status,j.attempt_count,j.available_at,j.last_error,j.updated_at FROM outbound_jobs j WHERE j.status IN ('FAILED','UNKNOWN','PENDING') ORDER BY j.created_at LIMIT 100").all();
  res.json({jobs});
});
app.post('/api/outbound/jobs/:id/retry',auth,requirePermission('diagnostics.retry'),(req,res)=>{
  if(!/^[a-f0-9-]{32,36}$/i.test(req.params.id as string)){res.status(400).end();return;}
  if(!retryOutboundJob(req.params.id as string)){res.status(409).json({error:'Solo FAILED con rechazo confirmado puede reintentarse; UNKNOWN requiere reconciliación'});return;}
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id) VALUES (?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'outbound_job_retry','outbound_job',req.params.id);
  res.json({ok:true});
});
app.post('/api/jobs/:id/retry',auth,requirePermission('diagnostics.retry'),(req,res)=>{
  if(!/^[a-f0-9-]{32,36}$/i.test(req.params.id as string)){res.status(400).end();return;}
  if(!retryJob(req.params.id as string)){res.status(409).json({error:'Job no está FAILED'});return;}
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id) VALUES (?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'inbound_job_retry','job',req.params.id);
  res.json({ok:true});
});
app.get('/api/diagnostics',auth,requirePermission('diagnostics.view'),(req,res)=>{
  const status=req.query.status==='RESOLVED'?'RESOLVED':'OPEN';
  const incidents=db.prepare('SELECT id,code,severity,component,status,title,user_message,technical_message,correlation_id,conversation_id,message_id,job_id,http_status,attempt_count,first_seen_at,last_seen_at,occurrence_count FROM system_incidents WHERE status=? ORDER BY last_seen_at DESC LIMIT 100').all(status);
  const active=(db.prepare("SELECT COUNT(*) AS n FROM system_incidents WHERE status='OPEN'").get() as {n:number}).n;
  res.json({active,incidents});
});
app.get('/api/diagnostics/latency',auth,requirePermission('audit.view'),(req,res)=>{
  const minutes=Number(req.query.minutes||15);
  if(![15,60,1440].includes(minutes)){res.status(400).json({error:'Window must be 15, 60 or 1440 minutes'});return;}
  const report=aggregateLatency(minutes);
  const sockets=db.prepare("SELECT transport,ping_ms,reconnects FROM socket_latency WHERE updated_at>=datetime('now',?)").all(`-${minutes} minutes`) as Array<{transport:string;ping_ms:number|null;reconnects:number}>;
  const pings=sockets.map(x=>x.ping_ms).filter((x):x is number=>typeof x==='number').sort((a,b)=>a-b);
  const pct=(p:number)=>pings.length?Math.round(pings[Math.ceil(pings.length*p)-1]):null;
  res.json({...report,socket:{active:io.engine.clientsCount,transports:Object.fromEntries(['websocket','polling'].map(name=>[name,sockets.filter(s=>s.transport===name).length])),pingP50Ms:pct(.5),pingP95Ms:pct(.95),pingP99Ms:pct(.99),reconnects:sockets.reduce((sum,s)=>sum+s.reconnects,0)}});
});
app.get('/api/diagnostics/latency/:messageId',auth,requirePermission('audit.view'),(req,res)=>{
  const id=req.params.messageId as string;
  if(!/^[a-f0-9-]{36}$/i.test(id)){res.status(400).json({error:'Message ID inválido'});return;}
  const trace=traceForMessage(id);if(!trace){res.status(404).json({error:'Trazabilidad no disponible para este mensaje'});return;}
  const message=db.prepare('SELECT provider_event_id,provider_message_id,client_message_id,route,message_type FROM messages WHERE id=?').get(id);
  const job=db.prepare('SELECT id,status FROM jobs WHERE message_id=?').get(id)||db.prepare('SELECT id,status FROM outbound_jobs WHERE message_id=?').get(id)||null;
  res.json({messageId:id,trace,message,job,notes:{providerTimestamp:'Timestamp del evento del proveedor, no necesariamente hora de envío original de WhatsApp.',browserReceivedAt:'Clock del navegador; usa socket_ack_ms para duración monotónica de ida y vuelta.',providerMessageIdReceivedAt:'Solo indica que la API devolvió un campo id; su semántica como Message ID requiere validación contra callback real.'}});
});
app.post('/api/diagnostics/:id/resolve',auth,requirePermission('diagnostics.retry'),(req,res)=>{
  const id=req.params.id as string;if(!/^[a-f0-9-]{36}$/i.test(id)){res.status(400).end();return;}
  if(!resolveIncident(id,(res.locals.agent as Agent).id)){res.status(409).json({error:'Incidencia no encontrada o ya resuelta'});return;}
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,resource_type,resource_id,ip,user_agent) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),(res.locals.agent as Agent).id,'incident_resolve','incident',id,req.ip||null,String(req.headers['user-agent']||'').slice(0,255));
  res.json({ok:true});
});
app.get('/api/diagnostics/report',auth,requirePermission('diagnostics.view'),(_req,res)=>{
  const queue=db.prepare('SELECT status,COUNT(*) AS count FROM outbound_jobs GROUP BY status').all();
  const inbound=db.prepare('SELECT status,COUNT(*) AS count FROM jobs GROUP BY status').all();
  const incidents=db.prepare("SELECT code,component,severity,occurrence_count,last_seen_at FROM system_incidents WHERE status='OPEN' ORDER BY last_seen_at DESC LIMIT 30").all();
  res.json({version:'0.1.0',timestamp:new Date().toISOString(),backend:'online',worker:workerAlive()?'online':'offline',database:'online',inboundQueue:inbound,outboundQueue:queue,incidents});
});
// Serve the built console through the same HTTPS tunnel as the webhook when deployed.
// API errors must remain JSON, including missing resources and unknown routes.
app.use('/api',(_req,res)=>{
  res.status(404).json({error:'Endpoint o recurso no disponible'});
});
const frontendDir=resolve(root,'app/frontend/dist');
if (existsSync(frontendDir)) {
  app.use(express.static(frontendDir,{index:false}));
  app.get('/{*path}', (req,res,next) => {
    if (['/api','/webhooks','/media','/socket.io','/health'].some(prefix=>req.path===prefix||req.path.startsWith(`${prefix}/`))) { next(); return; }
    if(process.env.NODE_ENV!=='production'&&process.env.CAP_DEV_FRONTEND_ORIGIN==='http://127.0.0.1:5174'&&['127.0.0.1','localhost'].includes(req.hostname)){
      res.redirect(307,`http://127.0.0.1:5174${req.originalUrl}`);return;
    }
    res.sendFile(resolve(frontendDir,'index.html'));
  });
}
app.use((error: unknown,_req: Request,res: Response,_next: NextFunction) => {
  if (error instanceof multer.MulterError) { res.status(413).json({error:'Archivo demasiado grande o inválido'}); return; }
  logError('request_failed',error); res.status(500).json({error:'Error interno'});
});
if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(config.PORT, '127.0.0.1', 2048, () => {
     db.prepare('UPDATE agents SET connection_count=0 WHERE connection_count<>0').run();
    console.log(JSON.stringify({ service:'cap-web-demo',port:config.PORT,status:'online' }));
      if (process.env.CAP_WORKER_EXTERNAL !== 'true') startWorker();
      startMonitor();
     if (config.AUTO_REGISTER_WEBHOOK === 'true' && config.PUBLIC_WEBHOOK_URL && config.MESSAGESYNC_API_KEY && config.WEBHOOK_INGRESS_SECRET) void syncOwnedSubscription(config.PUBLIC_WEBHOOK_URL).then(r => console.log(JSON.stringify({ webhook:r.status }))).catch(e => logError('subscription_failed',e));
  });
}
export { app, httpServer };
export function stopRealtimeRelay(){clearInterval(realtimeTimer);clearInterval(presenceTimer);}

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
import { enqueue, onChange, sendReply } from './router.js';
import { ensureSubscription, listSubscriptions, sendWhatsapp } from './provider.js';
import { startWorker, wakeJobs, retryJob } from './worker.js';
import { getAsset, mediaDirectory, retryMedia } from './media-service.js';
import { transitionConversation } from './state.js';
import { assignPending, assignmentChanged } from './assignment.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
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
type Agent = { id: string; username: string; password_hash?: string|null };
function agentForToken(token: string | undefined): Agent | null {
  if (!token) return null;
  const row = db.prepare('SELECT a.id,a.username FROM sessions s JOIN agents a ON a.id=s.agent_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1').get(hash(token), Date.now());
  return (row as Agent | undefined) || null;
}
const getSession = (req: Request) => agentForToken(req.cookies?.cap_session);
function auth(req: Request, res: Response, next: NextFunction) {
  const agent = getSession(req);
  if (!agent) { res.status(401).json({ error: 'Inicia sesión' }); return; }
  res.locals.agent = agent;
  next();
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
  const seen=()=>db.prepare("UPDATE agents SET status='ONLINE',last_seen_at=? WHERE id=?").run(new Date().toISOString(),id);
  seen();socket.emit('connected',{ok:true});
  socket.on('agent:heartbeat',()=>{seen();void assignPending();});
  void assignPending();
});
onChange(id => io.emit('conversation:changed', { id,lastSequence:getConversation(id)?.next_sequence||0 }));
assignmentChanged(id=>io.emit('conversation:changed',{id,lastSequence:getConversation(id)?.next_sequence||0}));
const presenceTimer=setInterval(()=>{
  const cutoff=new Date(Date.now()-config.AGENT_HEARTBEAT_TIMEOUT_SECONDS*1000).toISOString();
  db.prepare("UPDATE agents SET status='AWAY' WHERE status='ONLINE' AND (last_seen_at IS NULL OR last_seen_at<?)").run(cutoff);
},30000);
presenceTimer.unref();

app.post('/api/login', (req, res) => {
  if(!allowedRequest(`login:${req.ip}`,10)){res.status(429).json({error:'Espera un momento antes de intentarlo de nuevo'});return;}
  const body = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
  if (!body.success || body.data.username.length>80 || body.data.password.length>200) {
    res.status(401).json({ error: 'Credenciales incorrectas' }); return;
  }
  let agent = db.prepare('SELECT id,username,password_hash FROM agents WHERE username=? AND active=1').get(body.data.username) as Agent | undefined;
  const valid = agent?.password_hash ? (() => {
    const [salt, digest] = agent.password_hash!.split(':');
    return Boolean(salt && digest) && timingSafeEqual(scryptSync(body.data.password,salt,32),Buffer.from(digest,'hex'));
  })() : Boolean(config.ADMIN_PASSWORD && safeEqual(body.data.username,config.ADMIN_USER) && safeEqual(body.data.password,config.ADMIN_PASSWORD));
  if (!valid) { res.status(401).json({error:'Credenciales incorrectas'}); return; }
  if (!agent) {
    const id = randomUUID(); db.prepare('INSERT INTO agents(id,username,name) VALUES (?,?,?)').run(id, body.data.username, 'Administrador');
    agent = { id, username: body.data.username };
  }
  if (!agent.password_hash) {
    const salt = randomBytes(16).toString('hex');
    db.prepare('UPDATE agents SET password_hash=? WHERE id=?').run(`${salt}:${scryptSync(body.data.password,salt,32).toString('hex')}`,agent.id);
  }
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(hash(token), agent.id, Date.now() + 8 * 3600000);
  res.cookie('cap_session', token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure(req), maxAge: 8 * 3600000, path: '/' });
  res.json({ agent });
});
app.get('/api/me', auth, (_req, res) => res.json({ agent: res.locals.agent }));
app.post('/api/logout', auth, (req, res) => {
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
    const item = persistInbound(normalized);
    if (!item) { incrementCounter('duplicate_events_total');res.json({ duplicate: true }); return; }
    io.emit('conversation:changed', { id: item.conversationId,lastSequence:getConversation(item.conversationId)?.next_sequence||0 });
    wakeJobs();
    res.status(202).json({ accepted: true });
  } catch (error) { logError('inbound_failed', error, normalized.messageId); res.status(500).json({ error: 'Failed to store event' }); }
});
function logError(label: string, err: unknown, messageId?: string | null) {
  // No raw request data, headers or provider response bodies in logs.
  console.error(JSON.stringify({ label, messageId: messageId?.slice(0, 8), error: err instanceof Error ? err.message.replace(/(Bearer\s+|sk-)[^\s]+/ig, '[redacted]') : 'unknown' }));
}

app.get('/api/conversations', auth, (req, res) => {
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '';
  const condition = filter === 'pending' ? " AND v.mode='HUMAN_PENDING'" : filter === 'active' ? " AND v.mode='HUMAN_ACTIVE'" : filter === 'closed' ? " AND v.mode='CLOSED'" : filter === 'unread' ? " AND v.mode IN ('HUMAN_PENDING','HUMAN_ACTIVE') AND v.unread_count>0" : " AND v.mode IN ('HUMAN_PENDING','HUMAN_ACTIVE')";
  const cursor=typeof req.query.cursorTime==='string'&&typeof req.query.cursorId==='string'?{time:req.query.cursorTime.slice(0,50),id:req.query.cursorId.slice(0,100)}:null;
  const list = db.prepare(`SELECT v.*,c.name,c.phone,c.provider_contact_id,a.username AS assigned_to,
    (SELECT text FROM messages m WHERE m.conversation_id=v.id ORDER BY m.rowid DESC LIMIT 1) AS last_text
    FROM conversations v JOIN contacts c ON c.id=v.contact_id LEFT JOIN agents a ON a.id=v.assigned_agent_id
    WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.provider_contact_id LIKE ?) ${condition}
      AND (? IS NULL OR v.last_message_at<? OR (v.last_message_at=? AND v.id<?))
    ORDER BY v.last_message_at DESC,v.id DESC LIMIT 51`).all(...Array(3).fill(`%${search}%`),cursor?.time??null,cursor?.time??null,cursor?.time??null,cursor?.id??null) as Array<{id:string;last_message_at:string}>;
  const page=list.slice(0,50),last=page.at(-1);
  res.json({ conversations: page, nextCursor:list.length>50&&last?{time:last.last_message_at,id:last.id}:null });
});
app.get('/api/conversations/:id', auth, (req, res) => {
  const conversation = getConversation(req.params.id as string);
  if (!conversation) { res.status(404).end(); return; }
  res.json({ conversation, contact: getContact(conversation.contact_id) });
});
app.get('/api/conversations/:id/messages', auth, (req, res) => {
  if (!getConversation(req.params.id as string)) { res.status(404).end(); return; }
  const after=typeof req.query.afterSequence==='string'?Number(req.query.afterSequence):null;
  const before=typeof req.query.beforeSequence==='string'?Number(req.query.beforeSequence):null;
  if ((after!==null&&!Number.isSafeInteger(after))||(before!==null&&!Number.isSafeInteger(before))||(after!==null&&before!==null)) {res.status(400).json({error:'Cursor inválido'});return;}
  const fields='id,provider_message_id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text,media_url,mime_type,file_name,media_size,latitude,longitude,delivery_status,provider_timestamp,created_at,(SELECT COUNT(*) FROM media_assets a WHERE a.message_id=messages.id AND a.playable_path IS NOT NULL) AS playable_available';
  const query=after!==null?`SELECT ${fields} FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence ASC LIMIT 100`
    :`SELECT ${fields} FROM messages WHERE conversation_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT 101`;
  const rows=(after!==null?db.prepare(query).all(req.params.id,after):db.prepare(query).all(req.params.id,before,before)) as Array<{sequence:number}>;
  const hasMore=after===null&&rows.length>100;
  const messages=after!==null?rows:rows.slice(0,100).reverse();
  res.json({messages,hasMore,nextBeforeSequence:hasMore?messages[0]?.sequence:null});
});
app.post('/api/conversations/:id/read', auth, (req,res) => {
  const id=req.params.id as string;
  if (!getConversation(id)) { res.status(404).end(); return; }
  db.prepare('UPDATE conversations SET unread_count=0 WHERE id=?').run(id);
  io.emit('conversation:changed',{id}); res.json({ok:true});
});
app.post('/api/conversations/:id/claim', auth, async (req, res) => {
  const id = req.params.id as string;
  const result = transitionConversation(id,'CLAIM',{agentId:(res.locals.agent as Agent).id});
  if (!result.ok) { res.status(409).json({ error: result.reason }); return; }
  io.emit('conversation:changed', { id });
  try { await enqueue(id, () => sendReply(getConversation(id)!, getMenu().claim, 'human', 'HUMAN').then(() => {})); res.json({ ok: true }); }
  catch (err) { logError('claim_send_failed', err); res.status(502).json({ error: 'Tomado; saludo no entregado' }); }
});
app.post('/api/conversations/:id/return-to-bot', auth, async (req, res) => {
  const id = req.params.id as string, c = getConversation(id);
  if (!c) { res.status(404).end(); return; }
  if (c.mode !== 'HUMAN_ACTIVE' && c.mode !== 'HUMAN_PENDING') { res.status(409).json({ error: 'No está en modo humano' }); return; }
  const result=transitionConversation(id,'RETURN_MENU');
  if(!result.ok){res.status(409).json({error:result.reason});return;}
  void assignPending();
  io.emit('conversation:changed', { id });
  try { await enqueue(id, () => sendReply(getConversation(id)!, getMenu().returnToBot, 'bot', 'MENU').then(() => {})); res.json({ ok: true }); }
  catch (err) { logError('return_send_failed', err); res.status(502).json({ error: 'Estado cambiado; mensaje no entregado' }); }
});
app.post('/api/conversations/:id/close', auth, async (req, res) => {
  const id = req.params.id as string;
  const c=getConversation(id);
  if (!c) { res.status(404).end(); return; }
  if(c.mode!=='HUMAN_ACTIVE'||c.assigned_agent_id!==(res.locals.agent as Agent).id){res.status(409).json({error:'Solo el asesor asignado puede cerrar'});return;}
  try {
    await enqueue(id,async()=>{
      const started=transitionConversation(id,'BEGIN_CLOSE');
      if(!started.ok)throw new Error(started.reason);
      io.emit('conversation:changed',{id});
      try {
        const clientId=`close:${id}`;
        const previous=db.prepare('SELECT * FROM messages WHERE client_message_id=?').get(clientId) as ReturnType<typeof getMessage>;
        if(previous?.delivery_status==='failed') {
          const pending=db.prepare("UPDATE messages SET delivery_status='pending' WHERE id=? AND delivery_status='failed'").run(previous.id);
          if(!pending.changes)throw new Error('El cierre está en curso');
          const contact=getContact(c.contact_id);
          if(!contact)throw new Error('Contacto ausente');
          try{await sendWhatsapp(contact.provider_contact_id,previous.text);db.prepare("UPDATE messages SET delivery_status='sent' WHERE id=?").run(previous.id);}
          catch(err){db.prepare("UPDATE messages SET delivery_status='failed' WHERE id=?").run(previous.id);throw err;}
        } else if(!previous) await sendReply(getConversation(id)!,getMenu().close,'human','HUMAN',[],undefined,undefined,undefined,clientId);
        else if(previous.delivery_status!=='sent') throw new Error('Entrega del cierre sin confirmar');
        const done=transitionConversation(id,'CONFIRM_CLOSE');
        if(!done.ok)throw new Error(done.reason);
        void assignPending();
        io.emit('conversation.closed',{id});
        io.emit('conversation:changed',{id});
      } catch(err) {transitionConversation(id,'CLOSE_FAILED');io.emit('conversation:changed',{id});throw err;}
    });
    res.json({ok:true});
  }catch(err){logError('close_send_failed',err);res.status(502).json({error:'Cierre no confirmado; conversación disponible para reintentar'});}
});

const uploadDir = resolve(root, 'uploads'); mkdirSync(uploadDir, { recursive: true });
const allowedMime = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const extensions: Record<string,string> = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf','application/msword':'.doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.ms-excel':'.xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'};
const upload = multer({ storage: multer.diskStorage({destination: uploadDir,filename: (_req,file,cb) => cb(null,`${randomUUID()}${extensions[file.mimetype] || ''}`)}), limits: {fileSize:config.MAX_UPLOAD_MB*1024*1024,files:1}, fileFilter: (_req,file,cb) => cb(null, allowedMime.has(file.mimetype) && extname(file.originalname).toLowerCase() === extensions[file.mimetype]) });
app.post('/api/conversations/:id/messages', auth, upload.single('file'), async (req, res) => {
  const id = req.params.id as string, c = getConversation(id);
  if(!allowedRequest(`send:${(res.locals.agent as Agent).id}:${id}`,60)){res.status(429).json({error:'Demasiados mensajes; espera un momento'});return;}
  if (!c) { res.status(404).end(); return; }
  if (c.mode !== 'HUMAN_ACTIVE' || c.assigned_agent_id !== (res.locals.agent as Agent).id) { res.status(403).json({ error: 'Toma la conversación primero' }); return; }
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 10000) : '';
  const clientId=typeof req.body.clientRequestId==='string'&&/^[a-f0-9-]{36}$/i.test(req.body.clientRequestId)?req.body.clientRequestId:null;
  if(!clientId){res.status(400).json({error:'clientRequestId UUID requerido'});return;}
  const duplicate=db.prepare('SELECT id,conversation_id,delivery_status FROM messages WHERE client_message_id=?').get(clientId) as {id:string;conversation_id:string;delivery_status:string}|undefined;
  if(duplicate){if(req.file)unlinkSync(req.file.path);if(duplicate.conversation_id!==id){res.status(409).json({error:'ID de envío ya utilizado'});return;}res.status(duplicate.delivery_status==='failed'?409:200).json(duplicate.delivery_status==='failed'?{error:'Envío anterior falló; usa Reintentar',messageId:duplicate.id}:{ok:true,messageId:duplicate.id,status:duplicate.delivery_status});return;}
  if (!text && !req.file) { res.status(400).json({ error: 'Texto o archivo requerido' }); return; }
  if (req.file && !config.PUBLIC_URL) { res.status(503).json({ error: 'PUBLIC_URL requerida para adjuntos' }); return; }
  const url = req.file ? `${config.PUBLIC_URL.replace(/\/$/,'')}/media/${req.file.filename}` : '';
  try {
    let messageId = '';
    await enqueue(id, async () => { messageId = await sendReply(getConversation(id)!, text, 'human', 'HUMAN', url ? [url] : [], req.file?.mimetype, req.file?.originalname,undefined,clientId); });
    res.json({ ok: true, messageId });
  } catch (err) { logError('human_send_failed', err); res.status(502).json({ error: 'No entregado; consulta el estado del mensaje' }); }
});
app.post('/api/conversations/:id/messages/:messageId/retry', auth, async (req,res) => {
  const id=req.params.id as string,c=getConversation(id), m=getMessage(req.params.messageId as string);
  if(!c||!m||m.conversation_id!==id){res.status(404).end();return;}
  if(c.mode!=='HUMAN_ACTIVE'||c.assigned_agent_id!==(res.locals.agent as Agent).id||m.sender_type!=='human'||m.delivery_status!=='failed'){
    res.status(409).json({error:'Mensaje no reintentable'});return;
  }
  // Explicit manual retry only. Provider does not document outbound idempotency keys.
  const change=db.prepare("UPDATE messages SET delivery_status='pending' WHERE id=? AND delivery_status='failed'").run(m.id);
  if(!change.changes){res.status(409).json({error:'Ya se está reintentando'});return;}
  io.emit('conversation:changed',{id});
  try{
    await enqueue(id,async()=>{const {sendWhatsapp}=await import('./provider.js');const contact=getContact(c.contact_id);if(!contact)throw new Error('Contacto ausente');await sendWhatsapp(contact.provider_contact_id,m.text,m.media_url?[m.media_url]:[]);});
    db.prepare("UPDATE messages SET delivery_status='sent' WHERE id=?").run(m.id);
    io.emit('conversation:changed',{id});res.json({ok:true});
  }catch(err){db.prepare("UPDATE messages SET delivery_status='failed' WHERE id=?").run(m.id);io.emit('conversation:changed',{id});logError('retry_failed',err);res.status(502).json({error:'Reintento falló'});}
});
app.get('/api/media/:id',auth,(req,res)=>{
  const id=req.params.id as string;
  if(!/^[a-f0-9-]{36}$/i.test(id)){res.status(404).end();return;}
  const asset=getAsset(id);
  if(!asset||asset.storage_status!=='READY'){res.status(404).json({error:'Archivo no disponible'});return;}
  const mode=db.prepare('SELECT v.mode FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE m.id=?').get(asset.message_id) as {mode:string}|undefined;
  if(!mode||!['HUMAN_PENDING','HUMAN_ACTIVE','CLOSING','CLOSED'].includes(mode.mode)){res.status(404).end();return;}
  const playable=req.query.playable==='1'&&asset.playable_path;
  const name=playable?asset.playable_path:asset.storage_path;
  if(!name||!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(name)){res.status(404).end();return;}
  const path=resolve(mediaDirectory,name);
  if(!existsSync(path)){res.status(404).end();return;}
  const mime=playable?'audio/mpeg':asset.mime_type||'application/octet-stream';
  res.setHeader('Content-Type',mime);
  res.setHeader('Content-Disposition',/^(image|audio|video)\//.test(mime)?'inline':'attachment');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','private, max-age=300');
  res.sendFile(path);
});
app.post('/api/conversations/:id/media/:messageId/retry',auth,async(req,res)=>{
  const m=getMessage(req.params.messageId as string);
  const c=getConversation(req.params.id as string);
  if(!m||!c||m.conversation_id!==c.id||!['HUMAN_PENDING','HUMAN_ACTIVE','CLOSED'].includes(c.mode)){res.status(404).end();return;}
  await retryMedia(m.id);
  const status=db.prepare('SELECT storage_status FROM media_assets WHERE message_id=? LIMIT 1').get(m.id) as {storage_status:string}|undefined;
  io.emit('conversation:changed',{id:c.id,lastSequence:getConversation(c.id)?.next_sequence||0});
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
app.put('/api/menu', auth, (req,res) => {
  const current = getMenu();
  const data = z.object({ welcome:z.string().min(1),invalid:z.string().min(1),options:z.record(z.string(),z.object({intent:z.string(),reply:z.string().min(1)})),claim:z.string(),returnToBot:z.string(),close:z.string().min(1),image:z.string(),audio:z.string(),video:z.string(),aiFailure:z.string(),aiFlood:z.string(),quickReplies:z.array(z.string()) }).safeParse({ ...current, ...req.body });
  if (!data.success) { res.status(400).json({error:'Menú inválido'}); return; }
  writeFileSync(resolve(root,'config/menu.json'),JSON.stringify(data.data,null,2),'utf8'); io.emit('menu:changed'); res.json({ok:true});
});
app.get('/api/health', auth, (_req,res) => res.json({ database: db.prepare('SELECT 1 AS ok').get() ? 'online':'offline',
   messagesync: config.MESSAGESYNC_API_KEY ? 'configured':'unconfigured', n8n: config.N8N_AI_WEBHOOK_URL ? 'configured':'unconfigured',
  webhook: config.WEBHOOK_INGRESS_SECRET && config.PUBLIC_URL ? 'configured':'unconfigured', tunnel: config.PUBLIC_URL ? 'configured':'offline', websocket: 'online' }));
app.post('/api/subscription/register', auth, async (_req,res) => {
  if (!config.PUBLIC_URL) { res.status(400).json({error:'PUBLIC_URL requerida'}); return; }
  try { const result=await ensureSubscription(config.PUBLIC_URL); res.json(result); }
  catch (err) { logError('subscription_failed',err); res.status(502).json({error:'No se pudo registrar'}); }
});
app.get('/api/subscription/status', auth, async (_req,res) => {
  try { const list=await listSubscriptions(); res.json({ count:list.length, match:list.some(s => typeof s.targetUrl === 'string' && s.targetUrl.startsWith(config.PUBLIC_URL)) }); }
  catch (err) { logError('subscription_status_failed',err); res.status(502).json({error:'No se pudo consultar MessageSync'}); }
});
app.get('/api/metrics', auth, (_req,res) => {
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
app.get('/api/jobs/failed',auth,(_req,res)=>{
  const jobs=db.prepare("SELECT id,conversation_id,attempt_count,error,updated_at FROM jobs WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100").all();
  res.json({jobs});
});
app.post('/api/jobs/:id/retry',auth,(req,res)=>{
  if(!/^[a-f0-9-]{32,36}$/i.test(req.params.id as string)){res.status(400).end();return;}
  if(!retryJob(req.params.id as string)){res.status(409).json({error:'Job no está FAILED'});return;}
  res.json({ok:true});
});
// Serve the built console through the same HTTPS tunnel as the webhook when deployed.
const frontendDir=resolve(root,'app/frontend/dist');
if (existsSync(frontendDir)) {
  app.use(express.static(frontendDir,{index:false}));
  app.get('/{*path}', (req,res,next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/') || req.path.startsWith('/media/')) { next(); return; }
    res.sendFile(resolve(frontendDir,'index.html'));
  });
}
app.use((error: unknown,_req: Request,res: Response,_next: NextFunction) => {
  if (error instanceof multer.MulterError) { res.status(413).json({error:'Archivo demasiado grande o inválido'}); return; }
  logError('request_failed',error); res.status(500).json({error:'Error interno'});
});
if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(config.PORT, '127.0.0.1', 2048, () => {
    console.log(JSON.stringify({ service:'cap-web-demo',port:config.PORT,status:'online' }));
    startWorker();
    if (config.AUTO_REGISTER_WEBHOOK === 'true' && config.PUBLIC_URL && config.MESSAGESYNC_API_KEY && config.WEBHOOK_INGRESS_SECRET) void ensureSubscription(config.PUBLIC_URL).then(r => console.log(JSON.stringify({ webhook:r.status }))).catch(e => logError('subscription_failed',e));
  });
}
export { app, httpServer };

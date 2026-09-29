<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { io, type Socket } from 'socket.io-client';

type Mode='MENU'|'AI'|'HUMAN_PENDING'|'HUMAN_ACTIVE'|'CLOSING'|'CLOSED';
type Item={id:string;name:string|null;phone:string|null;provider_contact_id:string;mode:Mode;assigned_to:string|null;unread_count:number;last_text:string|null;last_message_at:string|null};
type Msg={id:string;sequence:number;direction:string;sender_type:string;route:string;message_type:string;text:string;media_url:string|null;mime_type:string|null;file_name:string|null;media_size:number|null;latitude:number|null;longitude:number|null;delivery_status:string|null;provider_timestamp:string|null;created_at:string;playable_available?:number};
type Menu={welcome:string;invalid:string;options:Record<string,{intent:string;reply:string}>;quickReplies:string[];claim:string;returnToBot:string;close:string;image:string;audio:string;video:string;aiFailure:string;aiFlood:string};
type Cursor={time:string;id:string}|null;
const agent=ref<{id:string;username:string}|null>(null),username=ref('admin'),password=ref(''),authError=ref('');
const items=ref<Item[]>([]),selected=ref<Item|null>(null),messages=ref<Msg[]>([]),menu=ref<Menu|null>(null),metrics=ref<Record<string,number>>({});
const filter=ref('all'),search=ref(''),draft=ref(''),file=ref<File|null>(null),busy=ref(false),error=ref(''),settings=ref(false),health=ref<Record<string,string>>({});
const theme=ref<'dark'|'light'>('dark'),chatScroll=ref<HTMLElement|null>(null),nextCursor=ref<Cursor>(null),hasOlder=ref(false),olderBusy=ref(false);
let socket:Socket|null=null,searchTimer:ReturnType<typeof setTimeout>|undefined,heartbeatTimer:ReturnType<typeof setInterval>|undefined,pendingRequestId:string|null=null;
const filters=[['all','Todos'],['pending','Esperando asesor'],['active','En atención'],['unread','No leídos'],['closed','Cerrados']];
const modeLabels:Record<Mode,string>={MENU:'BOT',AI:'IA',HUMAN_PENDING:'ESPERANDO',HUMAN_ACTIVE:'HUMANO',CLOSING:'CERRANDO',CLOSED:'CERRADO'};
const canSend=computed(()=>selected.value?.mode==='HUMAN_ACTIVE'&&selected.value.assigned_to===agent.value?.username);
const failedMessage=computed(()=>messages.value.slice().reverse().find(m=>m.sender_type==='human'&&m.delivery_status==='failed'));
const sharedLocations=computed(()=>messages.value.filter(m=>m.message_type==='location'&&m.latitude!==null&&m.longitude!==null&&Math.abs(m.latitude)<=90&&Math.abs(m.longitude)<=180));
const initial=(name:string|null)=>((name||'?').trim()[0]||'?').toUpperCase();
const when=(date:string|null)=>date?new Date(date.endsWith('Z')||date.includes('+')?date:date.replace(' ','T')+'Z').toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'}):'';
const mediaSafe=(url:string|null)=>url?.startsWith('/api/media/')?url:'';
const mapLink=(m:Msg)=>`https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=16/${m.latitude}/${m.longitude}`;
const playable=(m:Msg)=>m.media_url&&m.playable_available&&['audio/ogg','audio/opus'].includes(m.mime_type||'')?`${m.media_url}?playable=1`:mediaSafe(m.media_url);
const audioSupported=(m:Msg)=>typeof document!=='undefined'&&Boolean(document.createElement('audio').canPlayType(m.mime_type||''));
function openMedia(url:string|null){const safe=mediaSafe(url);if(safe)window.open(safe,'_blank','noopener,noreferrer');}
function onChatScroll(){if(chatScroll.value&&chatScroll.value.scrollTop<50)void loadOlder();}
function scheduleSearch(){clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadList(),300);}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',...init,headers:init.body instanceof FormData?init.headers:{'Content-Type':'application/json',...init.headers}});
  if(response.status===401){agent.value=null;disconnect();throw new Error('Inicia sesión nuevamente');}
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result as T;
}
async function login(){authError.value='';try{const r=await request<{agent:{id:string;username:string}}>('/api/login',{method:'POST',body:JSON.stringify({username:username.value,password:password.value})});agent.value=r.agent;password.value='';await boot();}catch(e){authError.value=(e as Error).message;}}
async function logout(){await request('/api/logout',{method:'POST'});agent.value=null;disconnect();}
async function loadList(append=false){
  try{
    const cursor=append&&nextCursor.value?`&cursorTime=${encodeURIComponent(nextCursor.value.time)}&cursorId=${encodeURIComponent(nextCursor.value.id)}`:'';
    const r=await request<{conversations:Item[];nextCursor:Cursor}>(`/api/conversations?filter=${filter.value}&search=${encodeURIComponent(search.value)}${cursor}`);
    items.value=append?[...items.value,...r.conversations.filter(i=>!items.value.some(old=>old.id===i.id))]:r.conversations;
    nextCursor.value=r.nextCursor;
    if(selected.value&&!append){const current=items.value.find(i=>i.id===selected.value?.id);if(current)selected.value=current;else if(filter.value!=='closed'){selected.value=null;messages.value=[];}}
  }catch(e){error.value=(e as Error).message;}
}
async function changeFilter(){selected.value=null;messages.value=[];nextCursor.value=null;await loadList();}
async function choose(item:Item){selected.value=item;messages.value=[];await loadMessages(true);void request(`/api/conversations/${item.id}/read`,{method:'POST'}).then(()=>loadList()).catch(()=>{});}
async function loadMessages(force=false){
  if(!selected.value)return;const id=selected.value.id,el=chatScroll.value,stick=force||!el||el.scrollHeight-el.scrollTop-el.clientHeight<110;
  try{
    const r=await request<{messages:Msg[];hasMore:boolean}>(`/api/conversations/${id}/messages`);
    if(selected.value?.id!==id)return;
    messages.value=r.messages.sort((a,b)=>a.sequence-b.sequence);hasOlder.value=r.hasMore;
    await nextTick();if(stick&&chatScroll.value)chatScroll.value.scrollTop=chatScroll.value.scrollHeight;
  }catch(e){error.value=(e as Error).message;}
}
async function loadMissing(){
  if(!selected.value||!messages.value.length)return;
  const id=selected.value.id,last=messages.value.at(-1)!.sequence;
  const r=await request<{messages:Msg[]}>(`/api/conversations/${id}/messages?afterSequence=${last}`);
  if(selected.value?.id===id&&r.messages.length){const ids=new Set(messages.value.map(x=>x.id));messages.value=[...messages.value,...r.messages.filter(x=>!ids.has(x.id))].sort((a,b)=>a.sequence-b.sequence);}
  if(selected.value?.id===id&&r.messages.length===100)await loadMessages(true);
}
async function loadOlder(){
  if(!selected.value||!hasOlder.value||olderBusy.value||!messages.value.length)return;
  olderBusy.value=true;const el=chatScroll.value,beforeHeight=el?.scrollHeight||0,id=selected.value.id;
  try{
    const r=await request<{messages:Msg[];hasMore:boolean}>(`/api/conversations/${id}/messages?beforeSequence=${messages.value[0].sequence}`);
    if(selected.value?.id===id){const ids=new Set(messages.value.map(x=>x.id));messages.value=[...r.messages.filter(x=>!ids.has(x.id)),...messages.value].sort((a,b)=>a.sequence-b.sequence);hasOlder.value=r.hasMore;await nextTick();if(el)el.scrollTop+=el.scrollHeight-beforeHeight;}
  }finally{olderBusy.value=false;}
}
async function refreshConversation(id:string){const wasSelected=selected.value?.id===id;await loadList();if(wasSelected&&selected.value?.id===id)await loadMissing();}
function connect(){
  disconnect();socket=io({transports:['websocket','polling']});
  socket.on('connect',()=>{socket?.emit('agent:heartbeat');void loadList();void loadMissing();});
  socket.on('conversation:changed',({id}:{id:string})=>{void refreshConversation(id);if(settings.value)void loadMetrics();});
  socket.on('conversation.closed',({id}:{id:string})=>{if(selected.value?.id===id&&filter.value!=='closed'){selected.value=null;messages.value=[];}void loadList();});
  socket.on('menu:changed',()=>void loadMenu());socket.on('connect_error',()=>{error.value='Sin conexión en tiempo real';});
  heartbeatTimer=setInterval(()=>{if(socket?.connected)socket.emit('agent:heartbeat');},25000);
}
function disconnect(){if(heartbeatTimer)clearInterval(heartbeatTimer);heartbeatTimer=undefined;socket?.disconnect();socket=null;}
async function loadMenu(){menu.value=await request<Menu>('/api/menu');}
async function loadHealth(){health.value=await request<Record<string,string>>('/api/health');}
async function loadMetrics(){metrics.value=await request<Record<string,number>>('/api/metrics');}
async function boot(){await Promise.all([loadList(),loadMenu(),loadHealth(),loadMetrics()]);connect();}
async function action(kind:'claim'|'return-to-bot'|'close'){
  if(!selected.value||busy.value)return;busy.value=true;error.value='';const id=selected.value.id;
  try{await request(`/api/conversations/${id}/${kind}`,{method:'POST'});await refreshConversation(id);}catch(e){error.value=(e as Error).message;await refreshConversation(id);}finally{busy.value=false;}
}
async function send(){
  if(!selected.value||!canSend.value||busy.value||(!draft.value.trim()&&!file.value))return;
  busy.value=true;error.value='';const id=selected.value.id,body=new FormData();pendingRequestId ||= crypto.randomUUID();
  body.append('clientRequestId',pendingRequestId);body.append('text',draft.value);if(file.value)body.append('file',file.value);
  try{await request(`/api/conversations/${id}/messages`,{method:'POST',body});draft.value='';file.value=null;pendingRequestId=null;await refreshConversation(id);}
  catch(e){error.value=(e as Error).message;await refreshConversation(id);}finally{busy.value=false;}
}
async function saveMenu(){if(!menu.value)return;try{await request('/api/menu',{method:'PUT',body:JSON.stringify(menu.value)});error.value='Menú guardado';}catch(e){error.value=(e as Error).message;}}
async function retryFailed(){if(!selected.value||!failedMessage.value||busy.value)return;busy.value=true;try{await request(`/api/conversations/${selected.value.id}/messages/${failedMessage.value.id}/retry`,{method:'POST'});await loadMessages();}catch(e){error.value=(e as Error).message;await loadMessages();}finally{busy.value=false;}}
onMounted(async()=>{try{const r=await request<{agent:{id:string;username:string}}>('/api/me');agent.value=r.agent;await boot();}catch{}});
onUnmounted(()=>{clearTimeout(searchTimer);disconnect();});
</script>

<template>
 <div :class="['app-shell',theme]">
  <div v-if="!agent" class="login-page"><form class="login-card" @submit.prevent="login"><div class="brand-mark">C</div><div class="eyebrow">CAP · CENTRO DE ATENCIÓN</div><h1>Bienvenido de nuevo</h1><p>Inicia sesión para atender conversaciones en tiempo real.</p><label>Usuario<input v-model="username" autocomplete="username" required></label><label>Contraseña<input v-model="password" type="password" autocomplete="current-password" required></label><span v-if="authError" class="form-error">{{authError}}</span><button class="primary wide">Entrar al panel <span>→</span></button></form></div>
  <template v-else>
   <header class="topbar"><div class="brand"><div class="brand-mark small">C</div><div><strong>CAP<span class="brand-light"> / inbox</span></strong><small>CENTRO DE ATENCIÓN HÍBRIDO</small></div></div><div class="topbar-right"><span class="live"><span class="live-dot"></span> En tiempo real</span><button class="icon-button" :title="theme==='dark'?'Modo claro':'Modo oscuro'" @click="theme=theme==='dark'?'light':'dark'">{{theme==='dark'?'☀':'◐'}}</button><button :class="['nav-button',settings?'active':'']" @click="settings=!settings">{{settings?'← Bandeja':'⚙ Configuración'}}</button><span class="user-avatar">{{initial(agent.username)}}</span><button class="icon-button" title="Cerrar sesión" @click="logout">↗</button></div></header>
   <div v-if="error" class="notice" role="status">{{error}} <button @click="error=''">×</button></div>
   <div v-if="!settings&&canSend&&failedMessage" class="retry-notice">El envío falló. Comprueba primero si llegó al cliente para evitar duplicados. <button :disabled="busy" @click="retryFailed">Reintentar envío</button></div>
   <div v-if="settings" class="settings-page"><div class="settings-head"><div class="eyebrow">ADMINISTRACIÓN</div><h1>Configuración</h1><p>Estado de la demo y respuestas preconfiguradas.</p></div><div class="settings-grid"><section class="settings-card"><h2>Estado de servicios <button class="link-button" @click="loadHealth">Actualizar</button></h2><div v-for="(value,key) in health" :key="key" class="status-row"><span>{{key}}</span><span :class="['status-chip',value==='online'?'good':'warn']">{{value}}</span></div><p class="muted small-text">“Configured” indica configuración presente; las pruebas de conectividad requieren un evento real.</p><h2>Métricas <button class="link-button" @click="loadMetrics">Actualizar</button></h2><div v-for="(value,key) in metrics" :key="key" class="status-row"><span>{{key.replaceAll('_',' ')}}</span><strong>{{value}}</strong></div></section><section v-if="menu" class="settings-card"><h2>Mensajes de WhatsApp</h2><label>Menú inicial<textarea v-model="menu.welcome" rows="7"></textarea></label><label v-for="(entry,key) in menu.options" :key="key">Opción {{key}} · {{entry.intent}}<textarea v-model="entry.reply" rows="3"></textarea></label><label>Mensaje de cierre<textarea v-model="menu.close" rows="4"></textarea></label><button class="primary" @click="saveMenu">Guardar menú</button></section></div></div>
   <div v-else class="workspace">
    <aside class="inbox"><div class="inbox-head"><div class="eyebrow">BANDEJA DE ASESORES</div><div class="heading-row"><h2>{{filter==='closed'?'Archivo':'Conversaciones'}}</h2><span class="count">{{items.length}}</span></div><div class="search"><span>⌕</span><input v-model="search" placeholder="Buscar por nombre, teléfono o ID" @input="scheduleSearch"></div></div><div class="filters"><button v-for="[id,label] in filters" :key="id" :class="['filter',filter===id?'active':'']" @click="filter=id;changeFilter()">{{label}}</button></div><div class="conversation-list"><button v-for="item in items" :key="item.id" :class="['conversation-item',selected?.id===item.id?'selected':'']" @click="choose(item)"><div class="avatar">{{initial(item.name)}}</div><div class="conversation-copy"><div class="conversation-title"><strong>{{item.name||item.phone||'Contacto'}}</strong><time>{{when(item.last_message_at)}}</time></div><p>{{item.last_text||'Sin texto'}}</p><div class="conversation-meta"><span :class="['mode-badge',item.mode.toLowerCase()]">{{modeLabels[item.mode]}}</span><span v-if="item.unread_count" class="unread">{{item.unread_count}}</span></div></div></button><div v-if="!items.length" class="empty-list">No hay conversaciones para este filtro.</div><button v-if="nextCursor" class="outline wide" @click="loadList(true)">Cargar más conversaciones</button></div><div class="inbox-foot"><span class="live-dot"></span> Mensajes sincronizados en vivo</div></aside>
    <main v-if="selected" class="chat"><div class="chat-header"><div class="avatar medium">{{initial(selected.name)}}</div><div><h2>{{selected.name||selected.phone||'Contacto'}}</h2><small>WhatsApp · {{selected.phone||'Número no disponible'}}</small></div><span :class="['mode-badge',selected.mode.toLowerCase()]">{{modeLabels[selected.mode]}}</span></div>
     <div ref="chatScroll" class="message-list" @scroll="onChatScroll"><button v-if="hasOlder" class="link-button" :disabled="olderBusy" @click="loadOlder">Cargar mensajes anteriores</button><div v-for="msg in messages" :key="msg.id" :class="['message-row',msg.direction==='outbound'?'outbound':'inbound']"><div class="bubble"><div class="bubble-by">{{msg.sender_type==='customer'?'CLIENTE':msg.sender_type==='human'?'AGENTE':'BOT'}} <span v-if="msg.route!=='NONE'" :class="['route',msg.route.toLowerCase()]">{{msg.route}}</span></div><div v-if="msg.text" class="message-text">{{msg.text}}</div>
      <img v-if="['image','sticker'].includes(msg.message_type)&&mediaSafe(msg.media_url)" :src="mediaSafe(msg.media_url)" loading="lazy" alt="Imagen compartida" class="media-image" @click="openMedia(msg.media_url)">
      <template v-else-if="msg.message_type==='audio'&&mediaSafe(msg.media_url)"><audio v-if="audioSupported(msg)||msg.playable_available" :src="playable(msg)" controls preload="none"></audio><a v-else :href="mediaSafe(msg.media_url)" download>Descargar audio (formato no compatible)</a></template>
      <video v-else-if="msg.message_type==='video'&&mediaSafe(msg.media_url)" :src="mediaSafe(msg.media_url)" controls preload="none" class="media-video"></video>
      <a v-else-if="msg.media_url&&mediaSafe(msg.media_url)" :href="mediaSafe(msg.media_url)" target="_blank" rel="noopener noreferrer" download>📎 {{msg.file_name||msg.message_type}} <span v-if="msg.mime_type">· {{msg.mime_type}}</span><span v-if="msg.media_size"> · {{Math.ceil(msg.media_size/1024)}} KB</span></a>
      <span v-else-if="msg.message_type!=='text'" class="muted">{{msg.message_type}} · archivo no disponible</span>
      <div class="bubble-bottom"><time>{{when(msg.provider_timestamp||msg.created_at)}}</time><span v-if="msg.delivery_status" :class="['delivery',msg.delivery_status]">{{msg.delivery_status==='failed'?'Error de envío':msg.delivery_status}}</span></div></div></div><div v-if="!messages.length" class="chat-empty">Aún no hay mensajes en esta conversación.</div></div>
     <div v-if="canSend" class="composer"><div class="quick-replies" v-if="menu"><button v-for="reply in menu.quickReplies" :key="reply" @click="draft=reply">{{reply}}</button></div><div class="compose-box"><textarea v-model="draft" placeholder="Escribe un mensaje..." rows="2" @keydown.enter.exact.prevent="send"></textarea><label class="attach-button" title="Adjuntar archivo">📎<input type="file" hidden @change="file=($event.target as HTMLInputElement).files?.[0]||null"></label><button class="primary" :disabled="busy||(!draft.trim()&&!file)" @click="send">Enviar ↗</button></div><small v-if="file" class="muted">Adjunto: {{file.name}}</small></div><div v-else class="composer muted">{{selected.mode==='HUMAN_PENDING'?'Toma la conversación para responder.':selected.mode==='CLOSED'?'Conversación archivada.':'No puedes responder en este estado.'}}</div>
    </main>
    <main v-else class="chat welcome-pane"><div class="welcome-art">✦</div><h2>Todo en un solo lugar</h2><p>Selecciona una conversación para empezar a atenderla.</p></main>
    <aside v-if="selected" class="details"><div class="details-title">CONTACTO</div><div class="contact-card"><div class="avatar large">{{initial(selected.name)}}</div><h2>{{selected.name||'Sin nombre'}}</h2><span :class="['mode-badge',selected.mode.toLowerCase()]">{{modeLabels[selected.mode]}}</span></div><div class="details-section"><div class="detail"><span>Teléfono</span><strong>{{selected.phone||'No disponible'}}</strong></div><div class="detail"><span>Contact ID</span><strong class="mono">{{selected.provider_contact_id}}</strong></div><div class="detail"><span>Asignado a</span><strong>{{selected.assigned_to||'Sin asignar'}}</strong></div><div class="detail"><span>Último mensaje</span><strong>{{when(selected.last_message_at)}}</strong></div></div><div v-if="sharedLocations.length" class="details-section"><div class="details-title">UBICACIONES</div><div v-for="location in sharedLocations" :key="location.id" class="detail"><span>📍 {{location.latitude}}, {{location.longitude}}</span><a :href="mapLink(location)" target="_blank" rel="noopener noreferrer">Ver mapa ↗</a></div></div><div class="details-section actions"><div class="details-title">ACCIONES</div><button v-if="selected.mode==='HUMAN_PENDING'" class="primary wide" :disabled="busy" @click="action('claim')">Tomar conversación →</button><button v-if="['HUMAN_ACTIVE','HUMAN_PENDING'].includes(selected.mode)" class="outline wide" :disabled="busy" @click="action('return-to-bot')">↩ Devolver al bot</button><button v-if="selected.mode==='HUMAN_ACTIVE'" class="outline wide" :disabled="busy" @click="action('close')">Cerrar conversación</button><p class="muted small-text">En modo humano no se llama al AI Engine de n8n.</p></div></aside>
   </div>
  </template>
 </div>
</template>

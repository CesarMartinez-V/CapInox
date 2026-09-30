<script setup lang="ts">
import { Search, EllipsisVertical, X, ContactRound, Tag, NotebookPen, ChevronUp, ChevronDown, History, Paperclip, SendHorizontal, LockKeyhole, Archive, Hand, ArrowLeftRight, CircleCheck, RotateCcw, UserRoundPlus } from '@lucide/vue';
const props=defineProps<{view:any}>();
const actionIcons:Record<string,any>={Hand,ArrowLeftRight,CircleCheck,RotateCcw,UserRoundPlus};
</script>
<template>
 <div class="workspace" data-parity="workspace">
  <section class="inbox-surface" data-parity="inbox-surface">
   <div class="inbox" data-parity="conversation-list">
    <label class="search" data-parity="search"><Search :size="20" :stroke-width="2"/><input :value="view.search" @input="view.onSearch" placeholder="Buscar" aria-label="Buscar conversaciones"></label>
    <details class="list-caption"><summary>{{view.listCaption}}</summary><div class="list-options"><button v-for="f in view.secondaryFilters" :key="f.id" @click="f.onClick">{{f.label}}</button><button v-if="view.hasMore" @click="view.loadMore">Cargar más conversaciones</button></div></details>
    <div class="conversation-list">
     <button v-for="it in view.items" :key="it.id" class="conversation-item" :class="{selected:it.selected}" :aria-current="it.selected?'true':undefined" @click="it.onClick">
      <span class="list-avatar" :style="{background:it.avBg,color:it.avFg}">{{it.initials}}</span>
      <span class="conversation-copy"><span class="conversation-title"><span>{{it.name}}</span><time>{{it.time}}</time></span><span class="conversation-preview"><span class="preview-text">{{it.preview}}</span><span v-if="it.unread" class="unread">{{it.unread}}</span></span><span class="conversation-meta"><span class="mode-badge" :style="{background:it.chipBg,color:it.chipFg}">{{it.chip}}</span><span class="assignment" :style="{color:it.subFg}">{{it.sub}}</span></span></span>
     </button>
     <div v-if="!view.items.length" class="empty-list">{{view.emptyText}}</div>
    </div>
    <span class="inbox-foot sr-only">{{view.connected?'Mensajes sincronizados en vivo':'Sin conexión en tiempo real'}}</span>
   </div>
   <div class="chat" data-parity="chat">
    <template v-if="view.sel">
     <header class="chat-header" data-parity="chat-header">
      <div class="chat-identity"><h1>{{view.sel.name}}</h1><div class="chat-subtitle"><span>{{view.sel.phone}}</span><span class="subtitle-dot"/><span>{{view.sel.assigned}}</span><span class="chat-mode" :style="{background:view.sel.chipBg,color:view.sel.chipFg}">{{view.sel.chip}}</span></div></div>
      <div class="chat-header-actions"><button v-for="a in view.actions" :key="a.label" :class="a.primary?'primary':'outline'" :disabled="a.disabled" :title="a.title" @click="a.onClick"><component :is="actionIcons[a.icon]" :size="18" :stroke-width="2"/>{{a.label}}</button><button class="contact-toggle" :aria-label="view.detailsOpen?'Cerrar información del contacto':'Abrir información del contacto'" title="Info del contacto" :aria-expanded="view.detailsOpen" @click="view.toggleDetails"><EllipsisVertical :size="22" :stroke-width="2"/></button></div>
     </header>
     <div v-if="view.banner" class="closed-banner"><Archive :size="20" :stroke-width="2"/><div><strong>{{view.banner.title}}</strong><span>{{view.banner.text}}</span></div><button v-if="view.banner.onClick" @click="view.banner.onClick">{{view.banner.actionLabel}}</button></div>
     <div :ref="view.messageRef" class="message-list" data-parity="messages" @scroll="view.onScroll">
      <button v-if="view.hasOlder" class="link-button" :disabled="view.olderBusy" @click="view.loadOlder">Cargar mensajes anteriores</button>
      <template v-for="m in view.messages" :key="m.id">
       <div v-if="m.system" class="system-message">{{m.text}} · {{m.time}}</div>
       <div v-else class="message-row" :class="m.inbound?'inbound':'outbound'" :style="{marginBottom:m.gap}">
        <span v-if="m.inbound" class="message-avatar" :style="{visibility:m.avatarVisible?'visible':'hidden',background:m.avBg,color:m.avFg}">{{m.initials}}</span>
        <div class="bubble" :style="{background:m.bg,color:m.fg}"><div v-if="m.labelVisible" class="bubble-by" :style="{color:m.labelFg}">{{m.label}}</div><div v-if="m.raw.message_type!=='text'" class="media-card"><slot name="media" :message="m.raw"/></div><div v-if="m.text" class="message-text">{{m.text}}</div><div class="bubble-bottom" :style="{color:m.metaFg}"><span v-if="m.status">{{m.status}}</span><time>{{m.time}}</time><details v-if="m.trace||m.retry" class="message-secondary"><summary aria-label="Opciones del mensaje"><EllipsisVertical :size="14"/></summary><button v-if="m.trace" class="link-button" @click="m.trace">Ver trazabilidad</button><button v-if="m.retry" class="link-button" title="Comprueba primero si llegó al cliente para evitar duplicados" @click="m.retry">Reintentar envío</button></details></div></div>
        <span v-if="!m.inbound" class="message-avatar" :style="{visibility:m.avatarVisible?'visible':'hidden',background:m.avBg,color:m.avFg}">{{m.initials}}</span>
       </div>
      </template>
      <div v-if="!view.messages.length" class="chat-empty">Aún no hay mensajes en esta conversación.</div>
     </div>
     <button v-if="view.newMessages" class="new-messages" @click="view.scrollBottom">Nuevos mensajes ↓</button>
     <div v-if="view.canSend" class="composer" data-parity="composer"><div class="quick-replies"><button v-for="q in view.quick" :key="q.text" @click="q.onClick">{{q.text}}</button></div><div class="compose-box" data-parity="compose-box"><label class="attach-button" title="Adjuntar imagen o documento" aria-label="Adjuntar"><Paperclip :size="20" :stroke-width="2"/><input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx" @change="view.onFile"></label><textarea :value="view.draft" @input="view.onDraft" @keydown.enter.exact.prevent="view.send" rows="1" placeholder="Escribe un mensaje… (Enter para enviar)" aria-label="Escribe un mensaje"/><button class="send-button" aria-label="Enviar" :disabled="view.sendDisabled" @click="view.send"><SendHorizontal :size="20" :stroke-width="2.2"/></button></div><small v-if="view.fileName" class="muted">Adjunto: {{view.fileName}}</small></div>
     <div v-else class="locked-composer" data-parity="composer"><LockKeyhole :size="18" :stroke-width="2"/><span>{{view.lockedText}}</span></div>
    </template>
    <div v-else class="welcome-pane"><div><div>Selecciona una conversación</div><p>Los chats en espera aparecen primero, ordenados por tiempo de espera.</p></div></div>
   </div>
  </section>
  <aside v-if="view.sel&&view.detailsOpen" class="details" data-parity="contact-panel">
   <section class="contact-overview" data-parity="contact-overview"><div class="details-heading"><h2>Info del contacto</h2><button class="close-details" aria-label="Cerrar panel de contacto" @click="view.toggleDetails"><X :size="20" :stroke-width="2"/></button></div><div class="contact-card"><span class="contact-avatar" :style="{background:view.sel.avBg,color:view.sel.avFg}">{{view.sel.initials}}</span><div><div>{{view.sel.name}}</div><small>WhatsApp · {{view.sel.window}}</small></div></div>
    <details class="details-accordion" :open="view.accordion==='contact'" @toggle="view.onAccordion('contact',$event)"><summary><ContactRound :size="20"/><span>Datos del chat</span><ChevronUp v-if="view.accordion==='contact'" :size="20"/><ChevronDown v-else :size="20"/></summary><template v-if="view.accordion==='contact'"><div class="detail-grid"><template v-for="[label,value] in view.contactRows" :key="label"><span>{{label}}</span><span>{{value}}</span></template></div><details class="contact-secondary"><summary>Más opciones</summary><div class="detail"><span>Contact ID</span><span class="mono">{{view.sel.providerId}}</span></div><button v-if="view.returnToBot" class="link-button" :disabled="view.busy" @click="view.returnToBot">Devolver al bot</button><slot name="contact-extra"/></details></template></details>
    <details class="details-accordion" :open="view.accordion==='tags'" @toggle="view.onAccordion('tags',$event)"><summary><Tag :size="20"/><span>{{view.tags.length}} etiquetas</span><ChevronUp v-if="view.accordion==='tags'" :size="20"/><ChevronDown v-else :size="20"/></summary><div v-if="view.accordion==='tags'" class="panel-tags"><span v-for="t in view.tags" :key="t.id" class="tag-chip">{{t.name}}</span><button v-for="t in view.tagSuggestions" :key="t.id" class="tag-suggestion" @click="t.onClick">+ {{t.name}}</button></div></details>
    <details class="details-accordion" :open="view.accordion==='notes'" @toggle="view.onAccordion('notes',$event)"><summary><NotebookPen :size="20"/><span>{{view.notes.length}} notas internas</span><ChevronUp v-if="view.accordion==='notes'" :size="20"/><ChevronDown v-else :size="20"/></summary><div v-if="view.accordion==='notes'" class="note-panel"><form v-if="view.canSend" @submit.prevent="view.addNote"><textarea :value="view.noteDraft" @input="view.onNote" rows="2" maxlength="2000" placeholder="Nota privada" aria-label="Nota privada: no se envía por WhatsApp"/><button class="note-save" :disabled="!view.noteDraft.trim()">Guardar nota</button></form><div v-for="n in view.notes" :key="n.id" class="internal-note"><div>{{n.text}}</div><small>{{n.author}} · {{n.date}}</small></div></div></details>
   </section>
   <section class="history-section" data-parity="history"><div class="history-heading"><h3>Historial · {{view.sessions.length}} sesiones</h3><History :size="20" :stroke-width="2"/></div><div class="history-list"><button v-for="h in view.sessions" :key="h.id" class="history-item" :class="{current:h.current}" @click="h.onClick"><span class="history-avatar">{{h.initials}}</span><span><strong>{{h.title}}</strong><small>{{h.agent}} · <span>{{h.chip}}</span></small></span></button></div></section>
  </aside>
 </div>
</template>

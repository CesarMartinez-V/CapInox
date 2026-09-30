<script setup lang="ts">
import { MessagesSquare, Clock3, UserRound, Bot, CalendarClock, Archive, ChartNoAxesCombined, ListTree, ShieldCheck, Settings2, Activity, ChevronDown } from '@lucide/vue';
import { ref, watch } from 'vue';
const props=defineProps<{view:any}>();
const secondaryOpen=ref(false);
watch(()=>props.view.profileOpen,()=>{secondaryOpen.value=false;});
const icons:Record<string,any>={MessagesSquare,Clock3,UserRound,Bot,CalendarClock,Archive,ChartNoAxesCombined,ListTree,ShieldCheck,Settings2,Activity};
</script>
<template>
 <nav class="sidebar" aria-label="Navegación principal" data-parity="rail">
  <button class="rail-brand" aria-label="Ir a conversaciones" @click="view.home"><img src="/brand/cap-inbox-source-mark.svg" alt="CAP Inbox"></button>
  <button v-for="r in view.filters" :key="r.id" class="rail-filter" :class="{active:r.active}" :aria-label="r.accessibleLabel||r.label" :aria-current="r.active?'page':undefined" @click="r.onClick">
   <span class="rail-icon"><component :is="icons[r.icon]" :size="24" :stroke-width="2"/><span v-if="r.badge" class="rail-badge">{{r.badge}}</span></span><span>{{r.label}}</span>
  </button>
  <span v-if="view.pages.length" class="rail-separator"/>
  <button v-for="p in view.pages" :key="p.id" class="rail-page" :class="{active:p.active}" :aria-current="p.active?'page':undefined" @click="p.onClick"><span class="rail-icon"><component :is="icons[p.icon]" :size="22" :stroke-width="2"/><span v-if="p.badge" class="rail-badge small">{{p.badge}}</span></span><span>{{p.label}}</span></button>
  <button class="rail-profile-trigger" aria-label="Abrir perfil y estado" :aria-expanded="view.profileOpen" @click="view.toggleProfile"><span class="profile-avatar">{{view.me.initials}}<span class="profile-presence" :style="{background:view.me.dot}"/></span><span>Perfil</span></button>
 </nav>
 <template v-if="view.profileOpen">
  <div class="profile-backdrop" @click="view.closeProfile"/>
  <div class="profile-popover" role="group" aria-label="Perfil">
   <div class="profile-identity"><span class="profile-large-avatar">{{view.me.initials}}</span><div><div class="profile-name">{{view.me.name}}</div><div class="profile-role">{{view.me.role}} · {{view.me.load}}</div></div></div>
   <div class="profile-status"><div class="profile-caption">Mi estado</div><button v-for="s in view.statuses" :key="s.id" class="status-option" :class="{active:s.active}" :aria-label="s.accessibleLabel||s.label" :aria-pressed="s.active" @click="s.onClick"><span :style="{background:s.dot}"/>{{s.label}}</button></div>
   <div class="profile-role-selector"><div>Rol y permisos</div><div><button v-for="r in view.roles" :key="r.id" :class="{selected:r.current}" :disabled="!r.current" :aria-label="r.current?'Más opciones':r.label" :title="r.current?'Más opciones':'El rol se administra en el servidor'" @click="secondaryOpen=!secondaryOpen">{{r.label}}</button></div><div v-if="secondaryOpen" class="profile-secondary-menu"><div class="profile-actions"><button v-for="p in view.secondary" :key="p.label" @click="p.onClick">{{p.label}}</button></div><div class="profile-connection"><span :class="['live-dot',view.connected?'':'offline']"/>{{view.connected?'Mensajes sincronizados en vivo':'Sin conexión en tiempo real'}}</div></div></div>
  </div>
 </template>
</template>

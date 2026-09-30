<script setup lang="ts">
import { ArrowUp, ArrowDown, Trash2, Bot, UserRound, MessageSquareText, Plus, RotateCcw, SendHorizontal, ChevronDown } from '@lucide/vue';
defineProps<{view:any}>();
const icons:Record<string,any>={Bot,UserRound,MessageSquareText};
</script>
<template>
 <main class="page-scroll canonical-page" data-parity="page">
  <div class="page-heading"><div><h1>Menú del bot</h1><p>Lo primero que recibe cada cliente. El listado de opciones se genera solo.</p></div><div class="menu-publish"><span>{{view.dirty?'Cambios sin publicar':'Publicado · en uso'}}</span><template v-if="view.canEdit&&view.dirty"><button class="outline page-action" @click="view.discard">Descartar</button><button class="primary page-action" @click="view.save">Publicar cambios</button></template></div></div>
  <div class="menu-columns" data-parity="menu-columns">
   <div class="menu-editor">
    <section class="card menu-welcome"><h3>Bienvenida</h3><label>Encabezado<textarea :value="view.header" @input="view.onWelcome" rows="3" :readonly="!view.canEdit"/></label><div class="menu-auto-options">Aquí se insertan automáticamente las opciones numeradas</div><label>Pie<textarea rows="3" :readonly="!view.canEdit||!view.canEditFooter" :value="view.footer" @input="view.onFooter"/></label></section>
    <div class="menu-options-heading"><h3>Opciones</h3><span>{{view.options.length}} de 9 opciones</span></div>
    <section v-for="o in view.options" :key="o.id" class="menu-option">
     <div class="menu-option-heading"><span>{{o.id}}</span><input :value="o.label" readonly aria-label="Nombre de la opción"><button aria-label="Subir" disabled><ArrowUp :size="18"/></button><button aria-label="Bajar" disabled><ArrowDown :size="18"/></button><button aria-label="Eliminar opción" disabled><Trash2 :size="18"/></button></div>
     <div class="menu-action-options"><span>Al elegirla:</span><button v-for="a in o.actions" :key="a.label" :class="{selected:a.selected}" disabled><component :is="icons[a.icon]" :size="15" :stroke-width="2.2"/>{{a.label}}</button></div>
     <div v-if="o.isAI" class="menu-intents"><span>Intención para la IA:</span><div class="segmented"><button v-for="i in o.intents" :key="i.id" :class="{selected:i.selected}" disabled>{{i.label}}</button></div></div>
     <label>Respuesta inmediata<textarea :value="o.reply" @input="o.onReply" rows="3" :readonly="!view.canEdit"/></label><p>{{o.hint}}</p>
    </section>
    <button class="menu-add" disabled><Plus :size="18" :stroke-width="2.2"/>Añadir opción</button>
    <section class="card menu-keywords"><h3>Palabras clave</h3><div v-for="k in view.keywords" :key="k.label"><strong>{{k.label}}</strong><p>{{k.help}}</p><div><span>—</span><input placeholder="Añadir y Enter" disabled></div></div></section>
    <section class="card menu-system"><h3>Mensajes automáticos</h3><details v-for="s in view.system" :key="s.id"><summary><span><strong>{{s.label}}</strong><small>{{s.help}}</small></span><ChevronDown :size="20"/></summary><textarea :value="s.text" @input="s.onInput" rows="4" :readonly="!view.canEdit||!s.editable"/></details></section>
    <section class="card menu-quick"><div><h3>Respuestas rápidas del asesor</h3><p>Aparecen sobre el cuadro de texto en cada chat.</p></div><div v-for="q in view.quick" :key="q.id"><input :value="q.text" @input="q.onInput" :readonly="!view.canEdit" placeholder="Texto de la respuesta"><button aria-label="Eliminar" disabled><Trash2 :size="18"/></button></div><button disabled>+ Añadir respuesta</button></section>
   </div>
   <aside class="menu-preview" data-parity="menu-preview"><div><div><strong>Vista previa</strong><small>Borrador sin publicar · no envía nada</small></div><button aria-label="Reiniciar prueba" disabled><RotateCcw :size="18"/></button></div><div class="menu-preview-chat"><div>{{view.welcome}}</div></div><div class="menu-preview-input"><input placeholder="Escribe como cliente…" disabled><button aria-label="Enviar prueba" disabled><SendHorizontal :size="18" :stroke-width="2.2"/></button></div><p>Prueba escribiendo 1–{{view.options.length}}, una palabra clave o cualquier texto.</p></aside>
  </div>
 </main>
</template>

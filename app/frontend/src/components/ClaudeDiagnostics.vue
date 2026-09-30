<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
defineProps<{view:any}>();
</script>
<template>
 <main class="page-scroll canonical-page" data-parity="page"><div class="page-heading"><div><h1>Diagnóstico</h1><p>Salud de los servicios e incidencias activas.</p></div><button class="outline page-action" @click="view.copy">Copiar reporte sin credenciales</button></div>
  <div class="service-grid" data-parity="services"><article v-for="s in view.services" :key="s.id" class="service-card" :class="{degraded:s.degraded}"><div>{{s.label}}</div><strong>{{s.value}}</strong></article></div>
  <section class="incident-section" data-parity="incidents"><h3>Incidencias activas</h3><div v-for="i in view.incidents" :key="i.id" class="canonical-incident"><span class="incident-icon"><TriangleAlert :size="20" :stroke-width="2.2"/></span><div><div><strong>{{i.title}}</strong><span> · {{i.severity}}</span></div><p>{{i.user_message}}</p><small>{{i.component}} · {{i.occurrence_count}} ocurrencias · {{i.time}}</small><details v-if="view.audit"><summary>Detalle técnico</summary><code>{{i.code}} — {{i.technical_message}}</code></details></div><button v-if="view.canResolve" @click="i.resolve">Marcar resuelta</button></div><p v-if="!view.incidents.length">Sin incidencias activas.</p></section>
 </main>
</template>

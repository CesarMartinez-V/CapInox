<script setup lang="ts">
import { CircleCheck, AlarmClock } from '@lucide/vue';
defineProps<{view:any}>();
</script>
<template>
 <main class="page-scroll canonical-page metrics-page" data-parity="page">
  <div class="page-heading" data-parity="page-heading"><div><h1>Métricas</h1><p>Volumen, resultados y tiempos de toda la operación.</p></div><div class="segmented"><button v-for="r in view.ranges" :key="r.id" :class="{selected:r.selected}" @click="r.onClick">{{r.label}}</button></div></div>
  <div class="agent-pills"><button v-for="a in view.agentFilters" :key="a.id" :class="{selected:a.selected}" @click="a.onClick">{{a.label}}</button></div>
  <template v-if="view.dashboard">
   <div class="kpi-grid" data-parity="kpis"><article v-for="k in view.kpis" :key="k.label" class="stat-card" :class="k.tone"><span>{{k.label}}</span><strong>{{k.value}}</strong><small>{{k.sub}}</small></article></div>
   <div class="metric-primary-row" data-parity="chart-row">
    <section class="card volume-chart" data-parity="volume-chart"><div class="chart-heading"><h3>{{view.barCaption}}</h3><div class="chart-legend"><span><i/>Recibidos</span><span><i/>Enviados</span></div></div><div class="volume-bars"><div v-for="b in view.bars" :key="b.label" :title="b.tip" class="volume-column"><div><span :style="{height:b.ah}"/><span :style="{height:b.bh}"/></div><span>{{b.label}}</span></div><span v-if="!view.bars.length" class="unmeasured" aria-label="Serie temporal no disponible">—</span></div></section>
    <section class="resolution-card" data-parity="resolution"><h3>¿Quién resolvió?</h3><div class="resolution-track"><span v-for="p in view.split" :key="p.label" :style="{flex:p.value??1,background:p.value===null?'transparent':p.color}"/></div><div v-for="p in view.split" :key="p.label" class="resolution-row"><i :style="{background:p.color}"/><span>{{p.label}}</span><strong>{{p.value??'—'}} {{p.value===null?'':'%'}}</strong></div><div class="sla-state" :class="{warning:view.slaCritical}"><AlarmClock v-if="view.slaCritical" :size="18" :stroke-width="2.2"/><CircleCheck v-else :size="18" :stroke-width="2.2"/><span>{{view.slaText}}</span></div></section>
   </div>
   <div class="metric-secondary-row" data-parity="secondary-row"><section class="card result-card"><h3>Resultados de cierre</h3><div v-for="d in view.dispositions" :key="d.label" class="result-bar"><span>{{d.label}}</span><span class="result-track"><i :style="{width:d.width,background:d.color}"/></span><strong>{{d.value}}</strong></div></section><section class="card timing-card"><div class="timing-header"><h3>Tiempos</h3><span>P50</span><span>P95</span></div><div v-for="t in view.timings" :key="t.label" class="timing-row"><span>{{t.label}}</span><strong>{{t.p50}}</strong><span>{{t.p95}}</span></div></section></div>
   <section class="card live-team" data-parity="team-table"><h3>Equipo en vivo</h3><div class="live-team-heading"><span>Asesor</span><span>Estado</span><span>Carga</span><span>Cerrados</span><span>Ventas</span><span>Recibidas</span><span>Transferidas</span></div><div v-for="a in view.agents" :key="a.id" class="live-team-row" :class="{selected:a.selected}"><span class="team-person"><span class="team-avatar">{{a.initials}}</span><span><strong>{{a.name}}</strong><small>{{a.role}}</small></span></span><span class="person-status"><i :style="{background:a.dot}"/>{{a.status}}</span><span class="person-load"><span><i :style="{width:a.loadWidth,background:a.loadColor}"/></span><small>{{a.load}}</small></span><strong>{{a.closed}}</strong><strong>{{a.sales}}</strong><span>{{a.incoming}}</span><span>{{a.outgoing}}</span></div></section>
  </template>
  <div v-else class="card empty-state" :role="view.error?'alert':'status'">{{view.loading?'Cargando métricas…':view.error||'Sin métricas disponibles.'}}<button v-if="view.error" class="outline" @click="view.retry">Reintentar</button></div>
 </main>
</template>

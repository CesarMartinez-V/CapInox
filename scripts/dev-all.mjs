import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { mkdirSync,writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root=resolve(import.meta.dirname,'..');
const full=process.argv.includes('--tunnel');
const children=[];
let closing=false;
let publicOrigin='';
const runtime=resolve(root,'data/runtime');
mkdirSync(runtime,{recursive:true});
function recordProcesses(){writeFileSync(resolve(runtime,'cap-processes.json'),JSON.stringify({root,supervisor:process.pid,startedAt:new Date().toISOString(),publicOrigin,children:children.map(child=>child.pid)},null,2));}
function stop(code=0){
  if(closing)return;closing=true;
  for(const child of children)if(child.exitCode===null)child.kill();
  process.exitCode=code;
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
function portOpen(port){return new Promise(resolvePort=>{const socket=connect(port,'127.0.0.1');socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolvePort(true);});socket.once('error',()=>resolvePort(false));socket.once('timeout',()=>{socket.destroy();resolvePort(false);});});}
function launch(name,executable,args,env=process.env){
   const child=spawn(executable,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
   children.push(child);
   recordProcesses();
   child.once('error',error=>{console.error(`${name}: ${error.message}`);stop(1);});
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>process.stdout.write(`[${name}] ${data}`));
  child.once('exit',code=>{if(!closing){console.error(`${name} terminó (${code}); deteniendo los otros procesos CAP.`);stop(1);}});
  return child;
}
function runQuickTunnel(){
  return new Promise((resolveOrigin,reject)=>{
    const child=spawn('cloudflared',['tunnel','--no-autoupdate','--protocol','http2','--url','http://127.0.0.1:3100'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    children.push(child);recordProcesses();
    let buffer='',resolved=false;
    const timeout=setTimeout(()=>reject(new Error('Cloudflare no devolvió una URL Quick Tunnel en 60 s')),60000);
    const fail=message=>{clearTimeout(timeout);if(!resolved)reject(new Error(message));else if(!closing){console.error(message);stop(1);}};
    child.once('error',()=>fail('No se pudo iniciar cloudflared'));
    child.once('exit',()=>fail('Quick Tunnel terminó; stack CAP detenido'));
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
      buffer=(buffer+data.toString()).slice(-12000);
      const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if(match&&!resolved){resolved=true;clearTimeout(timeout);console.log(`[tunnel] Quick Tunnel DEV: ${match[0]}`);resolveOrigin(match[0]);}
      if(/Registered tunnel connection/.test(data.toString()))console.log('[tunnel] conexión registrada');
    });
  });
}
async function waitBackend(){
  for(let attempt=0;attempt<40;attempt++){
    try{const res=await fetch('http://127.0.0.1:3100/health/ready',{signal:AbortSignal.timeout(1500)});if(res.ok)return;}catch{}
    await sleep(500);
  }
  throw new Error('Backend/worker no están listos; no se registra el webhook');
}
function runNamedTunnel(config){
  const args=['tunnel','--no-autoupdate','--protocol','http2','run',...(config.CLOUDFLARE_TUNNEL_NAME?[config.CLOUDFLARE_TUNNEL_NAME]:[])];
   const child=spawn('cloudflared',args,{cwd:root,env:{...process.env,TUNNEL_TOKEN:config.CLOUDFLARE_TUNNEL_TOKEN||''},stdio:['ignore','pipe','pipe'],windowsHide:true});
   children.push(child);
   recordProcesses();
   child.once('error',()=>{console.error('[tunnel] No se pudo iniciar cloudflared');stop(1);});
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
    const text=data.toString();
    if(/Registered tunnel connection/.test(text))console.log('[tunnel] conexión registrada');
    if(/ERR |error|failed/i.test(text))console.error('[tunnel] conexión falló; verifica token, hostname e ingress en Cloudflare');
  });
  child.once('exit',code=>{if(!closing){console.error(`Tunnel terminó (${code})`);stop(1);}});
  return child;
}
async function waitPublic(url){
  for(let attempt=0;attempt<30&&!closing;attempt++){
    try{const response=await fetch(`${url}/health/live`,{signal:AbortSignal.timeout(2500)});if(response.ok&&response.headers.get('content-type')?.includes('application/json')&&(await response.json()).backend==='online')return;}catch{}
    await sleep(1000);
  }
  throw new Error('Stable public webhook tunnel is not reachable; subscription was NOT changed.');
}
async function sync(url){
  const {syncOwnedSubscription}=await import('../app/backend/src/provider.ts');
  const result=await syncOwnedSubscription(url);
  console.log(`MessageSync: ${result.owned} suscripción CAP; ${result.otherSubscriptions} externas (no modificadas)`);
  if(result.otherSubscriptions)console.warn('Comprueba si otros triggers n8n siguen activos para esta Location.');
}
try{
   let publicUrl='';let config;let quick=false;
   if(await portOpen(3100)||await portOpen(5174))throw new Error('Puertos 3100/5174 ocupados. Ejecuta npm run stop:full para detener solo la instancia CAP anterior.');
  if(full){
    ({config}=await import('../app/backend/src/config.ts'));
    const {publicWebhookBase}=await import('../app/backend/src/provider.ts');
    if(config.CLOUDFLARE_TUNNEL_TOKEN||config.CLOUDFLARE_TUNNEL_NAME)publicUrl=publicWebhookBase();
    else{
      if(process.env.NODE_ENV==='production'||config.DEV_ALLOW_QUICK_TUNNEL!=='true')throw new Error('Quick Tunnel solo DEV. Configura Named Tunnel en producción o DEV_ALLOW_QUICK_TUNNEL=true para desarrollo.');
      quick=true;publicUrl=await runQuickTunnel();config.PUBLIC_WEBHOOK_URL=publicUrl;process.env.CAP_DEV_PUBLIC_URL=publicUrl;
      publicWebhookBase(publicUrl);
    }
    publicOrigin=publicUrl;recordProcesses();
    // Subscription rotation happens only after this supervisor checks public health.
    process.env.AUTO_REGISTER_WEBHOOK='false';
   }
   launch('backend',process.execPath,['--import','tsx','app/backend/src/server.ts'],{...process.env,CAP_WORKER_EXTERNAL:'true',CAP_DEV_FRONTEND_ORIGIN:process.env.NODE_ENV==='production'?'':'http://127.0.0.1:5174'});
  launch('worker',process.execPath,['--import','tsx','scripts/worker-standalone.ts']);
  launch('frontend',process.execPath,['node_modules/vite/bin/vite.js','--config','app/frontend/vite.config.ts','--host','127.0.0.1']);
  await waitBackend();
   if(full){if(!quick)runNamedTunnel(config);await waitPublic(publicUrl);await sync(publicUrl);}
  console.log('CAP Inbox listo: http://127.0.0.1:5174');
  console.log('Ctrl+C detiene los procesos iniciados por este comando.');
}catch(error){console.error(`Inicio CAP: ${error.message}`);stop(1);}

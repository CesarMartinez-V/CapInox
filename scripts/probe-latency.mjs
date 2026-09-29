import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
dotenv.config({path:resolve(import.meta.dirname,'../.env'),quiet:true});
const publicUrl=process.env.PUBLIC_WEBHOOK_URL||process.env.PUBLIC_URL||'';
const targets=[['local','http://127.0.0.1:3100/health/live']];
try{const origin=new URL(publicUrl);if(origin.protocol==='https:')targets.push(['public',origin.origin+'/health/live']);}catch{}
const p=(a,n)=>a.length?Math.round(a.sort((x,y)=>x-y)[Math.ceil(a.length*n)-1]):null;
for(const [label,url] of targets){
  const samples=[],failures=[];
  for(let i=0;i<8;i++){
    const begin=performance.now();
    try{const response=await fetch(url,{signal:AbortSignal.timeout(5000),headers:{'Cache-Control':'no-store'}});const data=await response.json();if(!response.ok||data.backend!=='online')failures.push(`HTTP ${response.status} or unexpected response`);else samples.push(performance.now()-begin);}
    catch(error){failures.push(error instanceof Error?error.name:'error');}
  }
  console.log(JSON.stringify({target:label,success:samples.length,failed:failures.length,errorTypes:[...new Set(failures)],p50_ms:p(samples,.5),p95_ms:p(samples,.95),p99_ms:p(samples,.99),note:'Health GET only; excludes WhatsApp provider delivery and browser Socket.IO; remote path is sampled from this host'}));
  const wsUrl=url.replace(/^http/,'ws').replace('/health/live','/socket.io/?EIO=4&transport=websocket');
  const begun=performance.now();
  const upgrade=await new Promise(resolve=>{
    const socket=new WebSocket(wsUrl);const deadline=setTimeout(()=>{socket.close();resolve({ok:false,error:'timeout'});},5000);
    socket.addEventListener('message',event=>{if(!String(event.data).startsWith('0'))return;clearTimeout(deadline);const duration=performance.now()-begun;socket.close();resolve({ok:true,ms:Math.round(duration)});},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(deadline);resolve({ok:false,error:'websocket_error'});},{once:true});
  });
  console.log(JSON.stringify({target:label,websocketUpgrade:upgrade,note:'Engine.IO WebSocket handshake only; does not prove authenticated browser transport or event delivery'}));
}

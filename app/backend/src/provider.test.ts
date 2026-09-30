import {test} from 'node:test';
import assert from 'node:assert/strict';

test('stable webhook sync checks public health and rotates only CAP-owned subscription using documented endpoints',async()=>{
  const {config}=await import('./config.js');
  const {syncOwnedSubscription,publicWebhookBase,expectedWebhookTarget}=await import('./provider.js');
  const old=globalThis.fetch,prior={key:config.MESSAGESYNC_API_KEY,location:config.GHL_LOCATION_ID,secret:config.WEBHOOK_INGRESS_SECRET,devQuick:config.DEV_ALLOW_QUICK_TUNNEL,quick:config.QUICK_TUNNEL_ALLOWED};
  config.DEV_ALLOW_QUICK_TUNNEL='false';config.QUICK_TUNNEL_ALLOWED='false';
  config.MESSAGESYNC_API_KEY='fixture-key';config.GHL_LOCATION_ID='fixture-location';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
  const base='https://cap.example.test',fresh=expectedWebhookTarget(base);
  const subs=[{id:'old-own',description:'web-demo-human-console',targetUrl:'https://old.example.test/webhooks/messagesync/old',events:['whatsapp.inbound','whatsapp.outbound']},{id:'external',description:'n8n - previous',targetUrl:'https://n8n.example.test/trigger',events:['whatsapp.inbound']}];
  const calls:string[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=String(input),method=init?.method||'GET';calls.push(`${method} ${new URL(url).pathname}`);
    if(url===base+'/health/live')return Response.json({backend:'online'});
    if(url.includes('/webhooks/subscriptions')&&method==='GET')return Response.json({data:subs});
    if(url.endsWith('/webhooks/subscriptions')&&method==='POST'){subs.push({id:'new-own',description:'web-demo-human-console',targetUrl:JSON.parse(String(init?.body)).targetUrl,events:['whatsapp.inbound','whatsapp.outbound']});return Response.json({id:'new-own'});}
    if(method==='DELETE'){const id=new URL(url).pathname.split('/').at(-1);const index=subs.findIndex(s=>s.id===id);if(index<0)return Response.json({}, {status:404});subs.splice(index,1);return Response.json({});}
    throw new Error('Unexpected endpoint');
  };
  try{
    assert.equal(publicWebhookBase(base),base);
    assert.throws(()=>publicWebhookBase('https://random.trycloudflare.com'),/stable public HTTPS/i);
    assert.equal((await syncOwnedSubscription(base)).owned,1);
    assert.deepEqual(subs.map(x=>x.id).sort(),['external','new-own']);
    assert.equal(subs.find(x=>x.id==='new-own')?.targetUrl,fresh);
    assert.ok(calls.includes('DELETE /v1/webhooks/subscriptions/old-own'));
    assert.ok(!calls.some(x=>x.includes('subscriptions/external')));
  }finally{globalThis.fetch=old;config.MESSAGESYNC_API_KEY=prior.key;config.GHL_LOCATION_ID=prior.location;config.WEBHOOK_INGRESS_SECRET=prior.secret;config.DEV_ALLOW_QUICK_TUNNEL=prior.devQuick;config.QUICK_TUNNEL_ALLOWED=prior.quick;}
});

// Read-only application smoke check (apart from creating an authenticated session).
// No API mocking, no WhatsApp sends, no customer contents in output.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';
import { config } from '../app/backend/src/config.ts';

const origin='http://127.0.0.1:5174';
const browser=await chromium.launch();
const context=await browser.newContext();
let socket;
try{
  const login=await context.request.post(`${origin}/api/login`,{data:{username:config.ADMIN_USER,password:config.ADMIN_PASSWORD}});
  assert.equal(login.status(),200,'Local admin login');
  const records=[];
  for(const path of ['/health/live','/health/ready','/api/me','/api/health','/api/conversations','/api/conversations?filter=closed','/api/conversations?filter=ai','/api/contacts','/api/agents','/api/users','/api/menu','/api/metrics','/api/metrics/dashboard','/api/diagnostics','/api/diagnostics/latency','/api/diagnostics/report','/api/outbound/jobs','/api/jobs/failed']){
    const started=performance.now(),response=await context.request.get(origin+path);
    assert.equal(response.status(),200,path);assert.match(response.headers()['content-type'],/application\/json/,path);
    const text=await response.text();assert.doesNotMatch(text,/<!doctype|<html/i,path);JSON.parse(text);
    records.push({path,status:response.status(),contentType:response.headers()['content-type'],ms:Math.round(performance.now()-started)});
  }
  const health=await(await context.request.get(origin+'/api/health')).json();
  const archive=await(await context.request.get(origin+'/api/conversations?filter=closed')).json();
  if(archive.conversations[0]){
    const response=await context.request.get(`${origin}/api/conversations/${archive.conversations[0].id}/messages`);
    assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/application\/json/);assert.ok(Array.isArray((await response.json()).messages));
  }
  const cookies=await context.cookies(origin);const cookie=cookies.find(item=>item.name==='cap_session');assert.ok(cookie,'Session cookie');
  socket=io(origin,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:`cap_session=${cookie.value}`}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Authenticated Socket timed out')),7000);socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('connect_error',error=>{clearTimeout(timer);reject(error);});socket.connect();});
  assert.equal(socket.io.engine.transport.name,'websocket');
  const page=await context.newPage();const errors=[],badApi=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/')&&!response.headers()['content-type']?.includes('application/json'))badApi.push(new URL(response.url()).pathname);});
  await page.goto(origin+'/inbox');await page.locator('.inbox-foot').filter({hasText:'Mensajes sincronizados en vivo'}).waitFor();
  await Promise.all([page.waitForResponse(response=>response.url().includes('/api/conversations?filter=closed')),page.getByRole('button',{name:'Archivo',exact:true}).click()]);
  await page.getByRole('button',{name:'Métricas',exact:true}).click();await page.locator('.stat-card').first().waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(badApi,[]);
  console.log(JSON.stringify({localResult:'PASS',requests:records,archiveConversations:archive.conversations.length,socket:{connected:socket.connected,transport:socket.io.engine.transport.name},browser:{pageErrors:errors,nonJsonApi:badApi,metricsRendered:true},health,remoteResult:health.messagesyncWebhook==='online'&&health.tunnel==='online'?'NEEDS_REAL_MESSAGE_TEST':'BLOCKED_PUBLIC_WEBHOOK'},null,2));
}finally{socket?.disconnect();await browser.close();}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
import { createServer as createVite } from 'vite';

process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';process.env.CAP_WORKER_EXTERNAL='true';

test('real Vue + Vite proxy + Express: login, JSON contracts, Socket, archive, metrics, notes, outbound and close',async()=>{
  const {db}=await import('./db.js');const {config,root}=await import('./config.js');
  config.ADMIN_USER='e2e-admin';config.ADMIN_PASSWORD='e2e-password-only-for-tests';
  config.MESSAGESYNC_API_KEY='';config.PUBLIC_WEBHOOK_URL='';config.N8N_AI_WEBHOOK_URL='';
  const {httpServer,stopRealtimeRelay}=await import('./server.js');
  const user=randomUUID(),active=randomUUID(),closed=randomUUID();
  db.prepare("INSERT INTO agents(id,username,name,role,status,manual_status) VALUES (?,?,'E2E Admin','SUPERADMIN','ONLINE','ONLINE')").run(user,config.ADMIN_USER);
  for(const [id,mode,name] of [[active,'HUMAN_ACTIVE','E2E Active'],[closed,'CLOSED','E2E Closed']]){
    const contact=randomUUID();db.prepare('INSERT INTO contacts(id,provider_contact_id,name) VALUES (?,?,?)').run(contact,randomUUID(),name);
    db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id,last_message_at) VALUES (?,?,?,?,datetime('now'))").run(id,contact,mode,user);
    db.prepare("INSERT INTO messages(id,conversation_id,contact_id,sequence,direction,sender_type,route,message_type,text) VALUES (?,?,?,1,'inbound','customer','HUMAN','text','E2E persisted message')").run(randomUUID(),id,contact);
    db.prepare('UPDATE conversations SET next_sequence=1 WHERE id=?').run(id);
  }
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const address=httpServer.address();assert.ok(address&&typeof address!=='string');
  const backend=`http://127.0.0.1:${address.port}`;
  const vite=await createVite({configFile:resolve(root,'app/frontend/vite.config.ts'),server:{port:0,strictPort:false,host:'127.0.0.1',proxy:{'/api':backend,'/health':backend,'/media':backend,'/webhooks':backend,'/socket.io':{target:backend,ws:true}}},logLevel:'error'});
  await vite.listen();const front=Object.values(vite.resolvedUrls!)[0]![0];
  const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1366,height:768}});
  const badApi:string[]=[],errors:string[]=[];
  page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/')&&!response.headers()['content-type']?.includes('application/json'))badApi.push(new URL(response.url()).pathname);});
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(front);await page.getByLabel('Usuario',{exact:true}).fill(config.ADMIN_USER);await page.getByLabel('Contraseña',{exact:true}).fill(config.ADMIN_PASSWORD);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await expect(page.locator('.inbox-foot')).toContainText('Mensajes sincronizados en vivo');
    const health=await page.request.get(new URL('/health/live',front).href);assert.match(health.headers()['content-type'],/application\/json/);
    const missing=await page.request.get(new URL('/api/missing-contract',front).href);assert.equal(missing.status(),404);assert.match(missing.headers()['content-type'],/application\/json/);
    await page.getByRole('button',{name:'Archivo',exact:true}).click();await page.getByRole('button',{name:/E2E Closed/}).click();await expect(page.getByText('Conversación finalizada',{exact:true})).toBeVisible();await expect(page.locator('.compose-box')).toHaveCount(0);
    await page.getByRole('button',{name:'Métricas',exact:true}).click();await expect(page.locator('.stat-card')).toHaveCount(5);await expect(page.getByText('Cargando métricas…')).toHaveCount(0);
    await page.getByRole('button',{name:'Equipo y permisos',exact:true}).click();const capacityUpdate=page.waitForResponse(response=>response.url().endsWith(`/api/users/${user}`)&&response.request().method()==='PATCH');await page.locator('.team-row').filter({hasText:'E2E Admin'}).getByRole('button',{name:'Más capacidad',exact:true}).click();assert.equal((await capacityUpdate).status(),200);assert.equal((db.prepare('SELECT max_active_chats FROM agents WHERE id=?').get(user) as {max_active_chats:number}).max_active_chats,6);
    await page.getByRole('button',{name:'Conversaciones',exact:true}).click();await page.getByRole('button',{name:/E2E Active/}).click();await page.locator('.details-accordion').filter({has:page.locator('summary',{hasText:'notas internas'})}).locator('summary').click();
    await page.getByPlaceholder('Nota privada').fill('E2E private note');await page.getByRole('button',{name:'Guardar nota'}).click();await expect(page.getByText('E2E private note',{exact:true})).toBeVisible();
    assert.equal((db.prepare('SELECT COUNT(*) n FROM conversation_notes WHERE text=?').get('E2E private note') as {n:number}).n,1);
    await page.getByRole('textbox',{name:'Escribe un mensaje'}).fill('E2E outbound durable');await page.getByRole('button',{name:'Enviar',exact:true}).click();await expect(page.locator('.message-text').filter({hasText:'E2E outbound durable'})).toBeVisible();
    assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE text=?').get('E2E outbound durable') as {n:number}).n,1);
    await page.locator('.chat-header-actions').getByRole('button',{name:'Finalizar'}).click();await page.locator('.action-modal select').selectOption('GENERAL_CLOSE');const closing=page.waitForResponse(response=>response.url().endsWith('/close')&&response.request().method()==='POST');await page.locator('.action-modal').getByRole('button',{name:'Cerrar conversación',exact:true}).click();assert.equal((await closing).status(),202);await expect(page.locator('.action-modal')).toHaveCount(0);
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(active) as {mode:string}).mode,'CLOSING',JSON.stringify(db.prepare('SELECT id,mode FROM conversations').all()));
    assert.deepEqual(badApi,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();await vite.close();stopRealtimeRelay();await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});

import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

const output=process.env.CAP_VISUAL_OUTPUT?join(process.cwd(),process.env.CAP_VISUAL_OUTPUT):join(process.cwd(),'docs','design-comparison','implemented');
const contact={id:'contact-1',name:'Juan Rodríguez',phone:'+52 81 2345 6789',provider_contact_id:'demo-contact',conversation_count:2,last_interaction_at:'2026-09-29T10:24:00Z'};
const conversation={...contact,id:'conversation-1',contact_id:contact.id,mode:'HUMAN_ACTIVE',assigned_to:'María González',unread_count:2,last_text:'Hola, ¿tienen disponible el filtro de aceite?',last_message_at:'2026-09-29T10:24:00Z'};
const conversations=[conversation,...[
  ['Ana Torres','¿Cuánto cuesta la batería para una Hilux?','HUMAN_PENDING'],
  ['Carlos Méndez','Perfecto, muchas gracias por la ayuda.','HUMAN_ACTIVE'],
  ['Distribuidora García','Necesitamos una cotización por volumen.','HUMAN_ACTIVE'],
  ['Laura Jiménez','¿Hacen envíos a Monterrey?','HUMAN_PENDING'],
  ['Miguel Santos','Adjunto imagen de la pieza que necesito.','HUMAN_ACTIVE']
].map(([name,text,mode],index)=>({...conversation,id:`conversation-${index+2}`,contact_id:`contact-${index+2}`,name,last_text:text,mode,unread_count:index%2,last_message_at:`2026-09-29T09:${50-index*8}:00Z`}))];
const archived={...conversation,id:'archived-1',mode:'CLOSED',unread_count:0};
const messages=[
  {id:'message-1',conversation_id:conversation.id,sequence:1,direction:'inbound',sender_type:'customer',route:'NONE',message_type:'text',text:'Hola, ¿tienen disponible el filtro de aceite para un Toyota Corolla 2020?',media_url:null,mime_type:null,file_name:null,media_size:null,duration:null,latitude:null,longitude:null,delivery_status:null,storage_status:null,provider_timestamp:null,created_at:'2026-09-29T10:12:00Z'},
  {id:'message-2',conversation_id:conversation.id,sequence:2,direction:'outbound',sender_type:'human',route:'HUMAN',message_type:'text',text:'¡Hola Juan! 👋\n\nSí, tenemos disponible el filtro de aceite original Toyota para Corolla 2020. Te comparto la información:',media_url:null,mime_type:null,file_name:null,media_size:null,duration:null,latitude:null,longitude:null,delivery_status:'sent',storage_status:null,provider_timestamp:null,created_at:'2026-09-29T10:14:00Z'},
  {id:'message-3',conversation_id:conversation.id,sequence:3,direction:'inbound',sender_type:'customer',route:'NONE',message_type:'text',text:'¡Excelente! ¿Me pueden confirmar si también tienen el filtro de aire?',media_url:null,mime_type:null,file_name:null,media_size:null,duration:null,latitude:null,longitude:null,delivery_status:null,storage_status:null,provider_timestamp:null,created_at:'2026-09-29T10:16:00Z'}
];
const dashboard={global:{conversations:248,inbound:820,outbound:612,sales:28,consultations:54,quotes:21,followups:16,pending:6},timings:{wait:{mean:52,p50:38,p95:96},firstHumanResponse:{mean:84,p50:84,p95:160},handling:{mean:420,p50:300,p95:800},aiLatencySeconds:{mean:2,p50:2,p95:3}},agents:[{id:'person-1',username:'María González',status:'ONLINE',active_chat_count:3,max_active_chats:5,closed:20,sales:5,consultations:8,transfersIn:1,transfersOut:0}],sla:{criticalPending:0,criticalSeconds:180}};
const user={id:'person-1',username:'María González',name:'María González',role:'SUPERADMIN',active:1,status:'ONLINE',active_chat_count:3,max_active_chats:5};
const menu={welcome:'¡Hola! Bienvenido a CAP Inbox.',invalid:'Elige una opción válida',options:{'1':{intent:'AI',reply:'Información de productos'},'2':{intent:'AI',reply:'Cotización'},'3':{intent:'AI',reply:'Consulta general'},'4':{intent:'HUMAN',reply:'Hablar con un asesor'}},quickReplies:['Claro, con gusto','Te envío la cotización','¿Necesitas algo más?'],claim:'',noAgent:'Un asesor pronto te atenderá.',returnToBot:'',close:'Gracias por conversar con nosotros.',image:'',audio:'',video:'',aiFailure:'',aiFailureNoAgent:'',aiFlood:''};
async function fixture(page:Page){
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url());const path=url.pathname;
    const body=path==='/api/me'?{agent:{id:'person-1',username:'María González',role:'SUPERADMIN',permissions:['conversation.view_all','conversation.claim','conversation.reply_all','conversation.transfer_all','settings.manage','audit.view','diagnostics.view','users.manage','metrics.view_all','campaigns.view']}}:
      path==='/api/conversations'?{conversations:url.searchParams.get('filter')==='closed'?[archived]:conversations,nextCursor:null}:
      path==='/api/conversations/conversation-1/messages'||path==='/api/conversations/archived-1/messages'?{messages:messages.map(m=>({...m,conversation_id:path.includes('archived')?'archived-1':conversation.id})),hasMore:false}:
      path==='/api/contacts'?{contacts:[contact],nextOffset:null}:
       path==='/api/contacts/contact-1/history'?{sessions:[{id:'conversation-1',mode:'HUMAN_ACTIVE',disposition:null,assigned_to:'María González',created_at:'2026-09-29T10:12:00Z'},{id:'previous-1',mode:'CLOSED',disposition:'QUOTE_SENT',assigned_to:'Luis Pérez',created_at:'2026-09-18T09:00:00Z'}]}:
       path==='/api/agents'?{agents:[{id:'person-1',username:'María González',status:'ONLINE',manual_status:'ONLINE',active_chat_count:3,max_active_chats:5},{id:'person-2',username:'César Martínez',status:'ONLINE',manual_status:'ONLINE',active_chat_count:1,max_active_chats:5}]}:
      path==='/api/conversations/conversation-1/notes'?{notes:[]}:
      path==='/api/conversations/conversation-1/tags'?{tags:[{id:'tag-1',name:'Cliente VIP',color:'#2ab3ae'}]}:
      path==='/api/tags'?{tags:[]}:
      path==='/api/health'?{backend:'online',database:'online',worker:'online',messagesync:'online',messagesyncWebhook:'online',n8nTransport:'reachable',aiEngine:'healthy'}:
      path==='/api/menu'?menu:path==='/api/metrics/dashboard'?dashboard:path==='/api/metrics'?{}:
      path==='/api/diagnostics'?{active:0,incidents:[]}:path==='/api/diagnostics/latency'?{samples:0,metrics:{},byRoute:{},socket:{transports:{},pingP95Ms:null,reconnects:0}}:
      path==='/api/users'?{users:[user]}:{ok:true};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('**/socket.io/**',route=>route.abort());
  await page.addInitScript(()=>localStorage.setItem('cap-inbox-theme','light'));
}

async function setDarkTheme(page:Page){await page.getByRole('button',{name:'Abrir perfil y estado'}).click();await page.getByRole('button',{name:'Más opciones',exact:true}).click();await page.getByRole('button',{name:'Modo oscuro'}).click();await page.locator('.profile-backdrop').click({position:{x:500,y:20}});}

for(const {name,width,height} of [{name:'1366',width:1366,height:768},{name:'1920',width:1920,height:1080}]){
  for(const theme of ['light','dark'] as const){
    for(const screen of ['archive','transfer','close','profile'] as const){
      test(`${screen}-${theme}-${name}`,async({page})=>{
        await page.setViewportSize({width,height});await fixture(page);
        await page.goto(screen==='archive'?'/inbox/archive':screen==='profile'?'/contacts':'/inbox');
          if(theme==='dark')await setDarkTheme(page);
        if(screen==='profile')await page.getByRole('button',{name:'Ver perfil'}).click();
        else{
          await page.getByRole('button',{name:/Juan Rodríguez/}).click();
           if(screen==='transfer')await page.locator('.chat-header-actions').getByRole('button',{name:'Transferir'}).click();
           if(screen==='close')await page.locator('.chat-header-actions').getByRole('button',{name:'Finalizar'}).click();
        }
        if(screen==='archive')await expect(page.getByText('Conversación finalizada')).toBeVisible();
        if(screen==='profile')await expect(page.getByText('Historial de conversaciones')).toBeVisible();
        if(screen==='transfer'||screen==='close')await expect(page.locator('.action-modal')).toBeVisible();
        await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
        await page.screenshot({path:join(output,`${screen}-${theme}-${name}.png`),animations:'disabled'});
      });
    }
  }
}

for(const {name,width,height} of [{name:'1366',width:1366,height:768},{name:'1440',width:1440,height:900},{name:'1600',width:1600,height:900},{name:'1920',width:1920,height:1080},{name:'2560',width:2560,height:1440}]){
  for(const theme of ['light','dark'] as const){
    for(const screen of ['login','inbox','contacts','campaigns','metrics','team','settings','diagnostics'] as const){
      test(`${screen}-${theme}-${name}`,async({page})=>{
        await page.setViewportSize({width,height});
        if(screen!=='login')await fixture(page);
        else await page.addInitScript(value=>localStorage.setItem('cap-inbox-theme',value),theme);
        await page.goto(screen==='settings'?'/settings/bot':screen==='login'?'/login':`/${screen}`);
        if(screen!=='login'){
          await expect(page.locator('.sidebar')).toBeVisible();
           if(screen==='inbox'){await page.getByRole('button',{name:/Juan Rodríguez/}).click();await expect(page.getByText('filtro de aceite para un Toyota')).toBeVisible();await expect(page.locator('.history-item')).toHaveCount(2);}
          else await expect(page.locator('.page-heading h1, .settings-content h1')).toBeVisible();
            if(theme==='dark')await setDarkTheme(page);
          await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
        }else await expect(page.getByRole('heading',{name:'Bienvenido'})).toBeVisible();
        await expect(page.locator('.app-shell')).toHaveClass(new RegExp(theme));
        const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight,screen:innerHeight}));
        expect(overflow.width).toBeLessThanOrEqual(width);
        expect(overflow.height).toBeLessThanOrEqual(height);
        await page.screenshot({path:join(output,`${screen}-${theme}-${name}.png`),animations:'disabled'});
      });
    }
  }
}

test('estado del perfil se guarda con el endpoint autenticado',async({page})=>{
  let posted='';await fixture(page);
  await page.route('**/api/agents/me/status',route=>{posted=route.request().postDataJSON().status;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,status:posted})});});
  await page.goto('/inbox');
  await page.getByRole('button',{name:'Abrir perfil y estado'}).click();
  await page.getByRole('button',{name:'Ausente'}).click();
  await expect(page.getByRole('button',{name:'Ausente'})).toHaveAttribute('aria-pressed','true');
  expect(posted).toBe('AWAY');
});

test('la navegación no abre pantallas de administrador para un agente',async({page})=>{
  await fixture(page);
  await page.route('**/api/me',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({agent:{id:'person-2',username:'agente',role:'AGENT',permissions:['conversation.view_own','conversation.claim']}})}));
  await page.goto('/metrics');
  await expect(page.locator('.workspace')).toBeVisible();
  for(const label of ['Campañas','Métricas','Equipo y permisos','Diagnóstico','Configuración'])await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0);
});

for(const {name,width,height} of [{name:'1366',width:1366,height:768},{name:'1920',width:1920,height:1080}]){
  test(`inbox-waiting-light-${name}`,async({page})=>{
    await page.setViewportSize({width,height});await fixture(page);
    await page.route('**/api/conversations?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conversations:[{...conversation,mode:'HUMAN_PENDING',assigned_to:null}],nextCursor:null})}));
    await page.goto('/inbox');await page.getByRole('button',{name:/Juan Rodríguez/}).click();
    await expect(page.locator('.chat-header-actions').getByRole('button',{name:'Tomar conversación'})).toBeVisible();
    await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
    await page.screenshot({path:join(output,`inbox-waiting-light-${name}.png`),animations:'disabled'});
  });
  test(`inbox-empty-light-${name}`,async({page})=>{
    await page.setViewportSize({width,height});await fixture(page);
    await page.route('**/api/conversations?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conversations:[],nextCursor:null})}));
    await page.goto('/inbox');await expect(page.getByText('No hay conversaciones en esta vista.')).toBeVisible();
    await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
    await page.screenshot({path:join(output,`inbox-empty-light-${name}.png`),animations:'disabled'});
  });
  test(`inbox-media-light-${name}`,async({page})=>{
    await page.setViewportSize({width,height});await fixture(page);
    const examples=[
      ['image','>IMAGE<','image/png','imagen.png'],
      ['audio','>AUDIO<','audio/mpeg','voz.mp3'],
      ['video','>VIDEO<','video/mp4','clip.mp4'],
      ['document','>DOCUMENT<','application/pdf','cotizacion.pdf']
    ].map(([message_type,text,mime_type,file_name],index)=>({...messages[0],id:`media-${index}`,sequence:index+1,message_type,text,mime_type,file_name,media_url:`/api/media/media-${index}`,media_size:2048,duration:index===1?15:null}));
    await page.route('**/api/conversations/conversation-1/messages',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({messages:examples,hasMore:false})}));
    await page.route('**/api/media/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="#dedff9"/><circle cx="90" cy="45" r="24" fill="#7678ed"/></svg>'}));
    await page.goto('/inbox');await page.getByRole('button',{name:/Juan Rodríguez/}).click();
    await expect(page.getByRole('button',{name:'Ampliar imagen compartida'})).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(1);
    await expect(page.getByRole('link',{name:/cotizacion.pdf/})).toBeVisible();
    await expect(page.getByText('>IMAGE<')).toHaveCount(0);
    await page.locator('.message-list').evaluate(element=>element.scrollTop=0);
    await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
    await page.screenshot({path:join(output,`inbox-media-light-${name}.png`),animations:'disabled'});
  });
}

test('el compositor envía al endpoint real con ID idempotente y deja la burbuja optimista',async({page})=>{
  await fixture(page);let sent='';
  await page.route('**/api/conversations/conversation-1/messages',async route=>{
    if(route.request().method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({messages,hasMore:false})});
    sent=route.request().postData()||'';
    return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({messageId:'sent-1',status:'queued'})});
  });
  await page.goto('/inbox');await page.getByRole('button',{name:/Juan Rodríguez/}).click();
  await page.getByRole('textbox',{name:'Escribe un mensaje'}).fill('Confirmo la cotización');
  await page.getByRole('button',{name:'Enviar'}).click();
  await expect(page.getByText('Confirmo la cotización')).toBeVisible();
  expect(sent).toContain('clientRequestId');
  expect(sent).toContain('Confirmo la cotización');
});

for(const {name,width,height} of [{name:'1366',width:1366,height:768},{name:'1920',width:1920,height:1080}]){
  test(`inbox-ai-light-${name} consulta su filtro real`,async({page})=>{
    await page.setViewportSize({width,height});await fixture(page);
    await page.route('**/api/conversations?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conversations:new URL(route.request().url()).searchParams.get('filter')==='ai'?[{...conversation,id:'ai-1',mode:'AI',assigned_to:null}]:conversations,nextCursor:null})}));
    await page.route('**/api/conversations/ai-1/messages',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({messages:[{...messages[0],conversation_id:'ai-1'}],hasMore:false})}));
    await page.goto('/inbox');await page.getByRole('button',{name:'IA y bot'}).click();
    await expect(page.locator('.conversation-item')).toHaveCount(1);
    await expect(page.locator('.conversation-item .mode-badge')).toHaveText('CAP IA');
    await page.getByRole('button',{name:/Juan Rodríguez/}).click();
    await page.addStyleTag({content:'.notice,.health-alert{display:none!important}'});
    await page.screenshot({path:join(output,`inbox-ai-light-${name}.png`),animations:'disabled'});
  });
}

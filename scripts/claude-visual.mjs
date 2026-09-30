import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const sourceRoot='C:/Users/PC/Downloads/WhatsApp chat management system';
const sourceFile=join(sourceRoot,'CAP Inbox.dc.html');
const html=await readFile(sourceFile,'utf8');
// Add measurement labels only, never CAP styles or markup. Original source hash is retained.
const marks={17:'shell',18:'rail',49:'workspace',50:'inbox-surface',51:'conversation-list',52:'search',59:'conversation-item',60:'list-avatar',72:'chat',74:'chat-header',76:'chat-subtitle',77:'chat-actions',82:'messages',85:'inbound-row',87:'inbound-bubble',92:'outbound-row',93:'outbound-bubble',101:'composer',102:'quick-replies',103:'compose-box',108:'composer',114:'contact-panel',115:'contact-overview',117:'contact-card',119:'detail-grid',130:'history',142:'page',143:'page-heading',144:'ranges',145:'agent-filters',146:'kpis',147:'kpi-card',148:'chart-row',149:'volume-chart',151:'volume-bars',153:'resolution',159:'secondary-row',160:'results',162:'timings',165:'live-team',175:'page',176:'page-heading',179:'menu-columns',180:'menu-editor',182:'menu-welcome',188:'menu-option',211:'menu-preview',213:'preview-chat',220:'team-page-condition',221:'page',222:'page-heading',224:'team-table',225:'team-table-heading',226:'team-row',234:'role-counts',235:'permissions',243:'page',244:'page-heading',245:'settings-tabs',246:'settings-columns',247:'settings-toggles',248:'settings-numbers',253:'dispositions',259:'whatsapp',260:'whatsapp-cards',266:'page',267:'page-heading',268:'services',269:'incidents',270:'incident',277:'modal'};
const markedHtml=html.split('\n').map((line,i)=>{
 const key=marks[i+1];if(!key)return line;
 const tag=[142,175,221,243,266].includes(i+1)?/<section\b/:/<(?:div|section|nav|header|aside|label|button|span)\b/;
 return line.replace(tag,match=>`${match} data-parity="${key}"`);
}).join('\n');
const sourceWithHeadings=markedHtml.replaceAll('<h1 ', '<h1 data-parity="heading" ').replace('style="position:fixed;left:112px','data-parity="profile" style="position:fixed;left:112px');
const sha=createHash('sha256').update(html).digest('hex');
const output=resolve('visual');
for(const part of ['reference/claude','actual/cap','diff'])await mkdir(join(output,part),{recursive:true});
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=resolve(sourceRoot,'.'+pathname);
  if(!path.startsWith(resolve(sourceRoot)))throw new Error('Outside reference root');
  let content=await readFile(path);
  if(path===resolve(sourceFile))content=Buffer.from(sourceWithHeadings.replace('componentDidMount(){','componentDidMount(){window.__claudeInstance=this;'));
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(content);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const refUrl=`http://127.0.0.1:${server.address().port}/CAP%20Inbox.dc.html`;
const browser=await chromium.launch();
const outcomes=[];
const wanted=process.argv.slice(2);
const screens=wanted.length?wanted:['inbox-human','inbox-waiting','inbox-mine','inbox-ai','archive','follow-up','profile','metrics','team','settings-routing','settings-ai','settings-dispositions','settings-whatsapp','bot','diagnostics','transfer','close','reopen'];
const measures=async(page,selectors)=>{
 const result={};
 for(const [key,selector] of Object.entries(selectors)){
  const loc=page.locator(selector).first();if(!await loc.count()||!await loc.isVisible())continue;
  result[key]=await loc.evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:b.x,y:b.y,w:b.width,h:b.height,font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,padding:s.padding,gap:s.gap,bg:s.backgroundColor,color:s.color,radius:s.borderRadius,border:s.borderWidth,overflowY:s.overflowY};});
 }
 return result;
};
const keys=['rail','inbox-surface','conversation-list','search','conversation-item','list-avatar','chat','chat-header','chat-subtitle','chat-actions','messages','composer','quick-replies','compose-box','contact-panel','contact-overview','contact-card','detail-grid','history','page','page-heading','ranges','agent-filters','kpis','kpi-card','chart-row','volume-chart','volume-bars','resolution','secondary-row','results','timings','live-team','team-table','team-table-heading','team-row','role-counts','permissions','settings-tabs','settings-columns','settings-toggles','settings-numbers','dispositions','whatsapp','whatsapp-cards','services','incidents','incident','menu-columns','menu-editor','menu-welcome','menu-option','menu-preview','preview-chat','modal'];
const sourceSelectors=Object.fromEntries(keys.map(key=>[key,`[data-parity="${key}"]`]));
const capSelectors={...sourceSelectors,'conversation-item':'.conversation-item','list-avatar':'.list-avatar','chat-subtitle':'.chat-subtitle','chat-actions':'.chat-header-actions','quick-replies':'.quick-replies','contact-card':'.contact-card','detail-grid':'.detail-grid',ranges:'.metrics-page .segmented','agent-filters':'.agent-pills','kpi-card':'.stat-card','volume-bars':'.volume-bars',results:'.result-card',timings:'.timing-card','live-team':'.live-team','team-table-heading':'.team-heading','team-row':'.team-row','settings-tabs':'.settings-tabs','settings-toggles':'.settings-columns > section:first-child','settings-numbers':'.settings-columns > section:last-child','whatsapp-cards':'.whatsapp-cards',incident:'.canonical-incident','menu-editor':'.menu-editor','menu-welcome':'.menu-welcome','menu-option':'.menu-option','preview-chat':'.menu-preview-chat',modal:'.action-modal'};
capSelectors['page-heading']='.page-heading';
sourceSelectors.heading='[data-parity="heading"]';capSelectors.heading='.page-heading h1,.chat-identity h1';sourceSelectors.profile='[data-parity="profile"]';capSelectors.profile='.profile-popover';

async function installFixture(page,state){
 const agents=state.agents.map(a=>({id:a.id,username:a.user,name:a.name,role:a.role,status:a.status==='PAUSED'?'AWAY':a.status,manual_status:a.status==='PAUSED'?'AWAY':a.status,max_active_chats:a.max,active_chat_count:state.convs.filter(c=>c.assignedTo===a.id&&c.mode==='HUMAN_ACTIVE').length,active:a.active?1:0}));
 const people=state.convs.map(c=>({id:c.id,contact_id:c.id,name:c.name,phone:c.phone,provider_contact_id:c.id,mode:c.mode,intent:c.intent,assigned_to:agents.find(a=>a.id===c.assignedTo)?.username||null,unread_count:c.unread,last_text:[...c.messages].reverse().find(m=>m.by!=='system')?.media||[...c.messages].reverse().find(m=>m.by!=='system')?.text||'',last_message_at:new Date(c.messages.at(-1).at).toISOString(),disposition:c.disposition||null}));
 const messages=c=>c.messages.map((m,i)=>({id:m.id,conversation_id:c.id,sequence:i+1,direction:m.by==='customer'?'inbound':m.by==='system'?'system':'outbound',sender_type:m.by==='customer'?'customer':m.by,route:m.by==='ai'?'AI':m.by==='human'?'HUMAN':'MENU',message_type:m.by==='system'?'system':m.media?'image':'text',text:m.text,media_url:null,mime_type:null,file_name:m.media,delivery_status:m.status||null,created_at:new Date(m.at).toISOString()}));
 const menu={welcome:state.menu.header+'\n\n'+state.menu.options.map((o,i)=>`${i+1}️⃣ ${o.label}`).join('\n')+'\n\n'+state.menu.footer,options:Object.fromEntries(state.menu.options.map((o,i)=>[String(i+1),{intent:o.intent,reply:o.reply}])),quickReplies:state.menu.quick,...state.menu.system};
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  const id=path.split('/')[3],conv=state.convs.find(c=>c.id===id);
  let body;
  if(path==='/api/me')body={agent:{id:'a3',username:'cesar',role:'SUPERADMIN',permissions:['conversation.view_all','conversation.view_own','conversation.claim','conversation.reply_all','conversation.transfer_all','conversation.close_all','conversation.assign','conversation.reopen','settings.manage','audit.view','diagnostics.view','diagnostics.retry','users.manage','metrics.view_all','campaigns.view']}};
  else if(path==='/api/conversations'){
   const filter=url.searchParams.get('filter');let rows=people.filter(c=>filter==='closed'?c.mode==='CLOSED':filter==='pending'?c.mode==='HUMAN_PENDING':filter==='active'?['HUMAN_ACTIVE','CLOSING'].includes(c.mode):filter==='ai'?['AI','MENU'].includes(c.mode):['HUMAN_ACTIVE','HUMAN_PENDING','CLOSING'].includes(c.mode));
   rows.sort((a,b)=>(a.mode==='HUMAN_PENDING')!==(b.mode==='HUMAN_PENDING')?(a.mode==='HUMAN_PENDING'?-1:1):a.mode==='HUMAN_PENDING'?a.last_message_at.localeCompare(b.last_message_at):b.last_message_at.localeCompare(a.last_message_at));body={conversations:rows,nextCursor:null};
  }
  else if(path.endsWith('/messages')&&conv)body={messages:messages(conv),hasMore:false};
  else if(path.endsWith('/notes')&&conv)body={notes:conv.notes.map(n=>({...n,created_at:new Date(n.at).toISOString()}))};
  else if(path.endsWith('/tags')&&conv)body={tags:conv.tags.map((name,i)=>({id:`t${i}`,name,color:'#e4e5fb'}))};
  else if(path.endsWith('/history')){const c=state.convs.find(c=>c.id===id);body={sessions:c?[{id:c.id,mode:c.mode,created_at:new Date(c.messages[0].at).toISOString(),disposition:c.disposition,assigned_to:agents.find(a=>a.id===c.assignedTo)?.username},...(c.past||[]).map(p=>({id:p.id,mode:'CLOSED',created_at:new Date(p.at).toISOString(),disposition:p.disposition,assigned_to:agents.find(a=>a.name===p.agent)?.username||p.agent}))]:[]};}
  else if(path==='/api/agents')body={agents};else if(path==='/api/users')body={users:agents};else if(path==='/api/tags')body={tags:[]};else if(path==='/api/menu')body=menu;
  else if(path==='/api/health')body={backend:'online',database:'online',worker:'online',messagesync:'online',messagesyncWebhook:'online',n8nTransport:'reachable',aiEngine:'stale',tunnel:'online'};
  else if(path==='/api/diagnostics')body={active:state.incidents.length,incidents:state.incidents.map(i=>({id:i.id,code:'fixture',severity:i.sev,component:i.comp,title:i.title,user_message:i.text,technical_message:'Isolated visual fixture',occurrence_count:i.count,last_seen_at:new Date(i.at).toISOString()}))};
  else if(path==='/api/diagnostics/latency')body={samples:0,metrics:{},byRoute:{},socket:{transports:{},pingP95Ms:null,reconnects:0}};
  else if(path==='/api/metrics/dashboard')body={global:{conversations:128,inbound:541,outbound:614,sales:17,consultations:38,quotes:22,followups:11,transfers:9},timings:{wait:{p50:65,p95:260},firstHumanResponse:{p50:48,p95:192},handling:{p50:660,p95:2040},aiLatencySeconds:{p50:3.2,p95:9.8}},agents:agents.map(a=>({...a,closed:0,sales:0,consultations:0,transfersIn:0,transfersOut:0})),sla:{criticalPending:1,criticalSeconds:180}};
  else body={ok:true};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.routeWebSocket('**/socket.io/**',ws=>{ws.send('0'+JSON.stringify({sid:'isolated-visual',upgrades:[],pingInterval:25000,pingTimeout:20000}));ws.onMessage(message=>{if(String(message)==='40')ws.send('40'+JSON.stringify({sid:'isolated-visual'}));else if(String(message)==='2')ws.send('3');});});
 await page.addInitScript(()=>localStorage.setItem('cap-inbox-theme','light'));
}
try{
 const viewports=process.env.CAP_VISUAL_VIEWPORTS?JSON.parse(process.env.CAP_VISUAL_VIEWPORTS):[[1440,900],[1366,768],[1920,1080]];
 for(const [width,height] of viewports){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'es',timezoneId:'UTC'});
  await context.addInitScript(()=>{const NativeDate=Date,fixed=Date.parse('2026-09-30T12:00:00Z');window.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(fixed);}static now(){return fixed;}};});
  const ref=await context.newPage();
  await ref.goto(refUrl);await ref.waitForFunction(()=>!!window.__claudeInstance);
  await ref.evaluate(()=>window.__claudeInstance.setState({role:'SUPERADMIN'}));await ref.evaluate(()=>document.fonts.ready);
  const state=await ref.evaluate(()=>JSON.parse(JSON.stringify(window.__claudeInstance.state)));
  for(const screen of screens){
   await ref.locator('nav').evaluate(el=>{el.scrollTop=0;});
   const selection=screen==='inbox-waiting'?'c1':screen==='inbox-ai'?'c5':screen==='archive'||screen==='reopen'?'c7':screen==='follow-up'?'c8':'c2';
   const filter=screen==='inbox-waiting'?'pending':screen==='inbox-ai'?'bot':screen==='archive'||screen==='reopen'?'closed':screen==='follow-up'?'follow':screen==='inbox-mine'?'mine':'active';
   const pageId=screen==='metrics'?'metrics':['team','new-user','deactivate'].includes(screen)?'team':screen.startsWith('settings-')?'settings':screen==='bot'?'menu':screen==='diagnostics'?'diag':'inbox';
   const settingsTab=screen.split('-')[1];
   await ref.evaluate(({selection,filter,pageId,screen,settingsTab,state})=>window.__claudeInstance.setState({convs:state.convs.map(c=>({...c,unread:c.id===selection?0:c.unread})),page:pageId,filter,selId:filter==='mine'?null:selection,role:'SUPERADMIN',modal:['transfer','close','reopen'].includes(screen)?screen:null,settingsTab:({routing:'routing',ai:'ai',dispositions:'disp',whatsapp:'wa'})[settingsTab]||'routing',profileOpen:false,rightTab:'contact',detailsHidden:false,detailsOpen:false}),{selection,filter,pageId,screen,settingsTab,state});
   await ref.waitForTimeout(180);
   if(screen==='new-user')await ref.evaluate(()=>window.__claudeInstance.setState({modal:'newUser'}));
   if(screen==='deactivate')await ref.evaluate(()=>window.__claudeInstance.setState({modal:'deact',deact:{id:'a1',target:'QUEUE'}}));
   const actual=await context.newPage();const errors=[];actual.on('pageerror',e=>errors.push(e.message));
   await installFixture(actual,state);
   const route=pageId==='inbox'?(filter==='closed'||filter==='follow'?'/inbox/archive':'/inbox'):pageId==='menu'?'/settings/bot':pageId==='settings'?`/settings/${settingsTab==='dispositions'?'dispositions':settingsTab==='whatsapp'?'whatsapp':settingsTab}`:pageId==='diag'?'/diagnostics':`/${pageId}`;
   await actual.goto('http://127.0.0.1:5174'+route);await actual.locator('.sidebar').first().waitFor();await actual.evaluate(()=>document.fonts.ready);
   if(pageId==='inbox'){
    if(filter==='pending')await actual.getByRole('button',{name:'En espera',exact:true}).click();
    if(filter==='bot')await actual.getByRole('button',{name:'IA y bot',exact:true}).click();
    if(filter==='mine')await actual.getByRole('button',{name:'Míos',exact:true}).click();
    if(filter==='follow')await actual.getByRole('button',{name:'Seguimiento',exact:true}).click();
    const chosen=state.convs.find(c=>c.id===selection);
    const item=actual.locator('.conversation-item').filter({hasText:chosen.name}).first();
    if(filter!=='mine'){await item.waitFor({state:'visible'});await item.click();await actual.locator('.chat-header').waitFor();}
    if(screen==='profile'){await ref.getByRole('button',{name:/Perfil$/}).click();await ref.evaluate(()=>window.__claudeInstance.setState({profileOpen:true}));await actual.getByRole('button',{name:'Abrir perfil y estado'}).click();}
    if(screen==='transfer')await actual.locator('.chat-header-actions').getByRole('button',{name:'Transferir',exact:true}).click();
    if(screen==='close')await actual.locator('.chat-header-actions').getByRole('button',{name:'Finalizar',exact:true}).click();
    if(screen==='reopen')await actual.locator('.chat-header-actions').getByRole('button',{name:'Reabrir',exact:true}).click();
   }
   if(screen==='new-user')await actual.getByRole('button',{name:'Nuevo usuario',exact:true}).click();
   if(screen==='deactivate')await actual.locator('.team-row').filter({hasText:'Ana Ruiz'}).getByRole('button',{name:/Ver estado/}).click();
   await actual.waitForTimeout(250);
   // Diagnostic fixture is an intentionally real active state; hide no application component.
   await actual.mouse.move(0,0);await ref.mouse.move(0,0);
   const file=`${screen}-${width}x${height}`;
   const rp=join(output,'reference/claude',file+'.png'),ap=join(output,'actual/cap',file+'.png');
   await ref.screenshot({path:rp,animations:'disabled'});await actual.screenshot({path:ap,animations:'disabled'});
   const referenceBoxes=await measures(ref,sourceSelectors),actualBoxes=await measures(actual,capSelectors);
   if(!referenceBoxes.rail||!actualBoxes.rail)throw new Error('Missing mandatory source/CAP measurements: parity capture invalid');
   const layout={};
   for(const key of Object.keys(referenceBoxes)){
    if(!actualBoxes[key]){layout[key]={status:'MISSING'};continue;}
    const deltas=Object.fromEntries(['x','y','w','h'].map(k=>[k,Math.round((actualBoxes[key][k]-referenceBoxes[key][k])*100)/100]));
    const styles=Object.fromEntries(['font','fontSize','fontWeight','lineHeight','letterSpacing','padding','gap','bg','color','radius','border','overflowY'].filter(k=>actualBoxes[key][k]!==referenceBoxes[key][k]).map(k=>[k,{reference:referenceBoxes[key][k],actual:actualBoxes[key][k]}]));
    layout[key]={status:Object.values(deltas).every(v=>Math.abs(v)<=2)?'GEOMETRY_MATCH':'DIFFERENT',deltas,styles};
   }
   const a=await sharp(rp).ensureAlpha().raw().toBuffer(),b=await sharp(ap).ensureAlpha().raw().toBuffer();const diff=Buffer.alloc(a.length);let changed=0;
   for(let i=0;i<a.length;i+=4){const distance=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(distance>24){changed++;diff[i]=255;diff[i+1]=40;diff[i+2]=80;diff[i+3]=255;}else{diff[i]=b[i];diff[i+1]=b[i+1];diff[i+2]=b[i+2];diff[i+3]=80;}}
   await sharp(diff,{raw:{width,height,channels:4}}).png().toFile(join(output,'diff',file+'.png'));
   const report={schemaVersion:2,capturedAt:new Date().toISOString(),screen,viewport:{width,height,dpr:1,zoom:1,timezone:'UTC',frozenDate:'2026-09-30T12:00:00Z'},reference:{source:sourceFile,sha256:sha,url:refUrl,screenshot:rp,transforms:'Measurement data-parity labels and test-only component exposure; no CAP styles or markup'},actual:{url:actual.url(),screenshot:ap},pixelDiff:{threshold:24,changedPixels:changed,totalPixels:width*height,percent:Math.round(changed/(width*height)*10000)/100,interpretation:'Includes text, chart values and state; not a similarity score'},referenceBoxes,actualBoxes,layout,errors};
   await writeFile(join(output,'diff',file+'.json'),JSON.stringify(report,null,2));outcomes.push(report);
   console.log(`${file}: ${report.pixelDiff.percent}% raw pixel delta; geometry differences: ${Object.entries(layout).filter(([,r])=>r.status==='DIFFERENT').map(([key])=>key).join(', ')||'none'}; missing: ${Object.entries(layout).filter(([,r])=>r.status==='MISSING').map(([key])=>key).join(', ')||'none'}; ${errors.length} browser errors`);
   await actual.close();
  }
  await context.close();
 }
 await writeFile(join(output,'diff',`summary-${Date.now()}.json`),JSON.stringify(outcomes.map(({screen,viewport,pixelDiff,layout,errors})=>({screen,viewport,pixelDiff,layout,errors})),null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source=resolve('C:/Users/PC/Downloads/WhatsApp chat management system/CAP Inbox.dc.html');
const output=resolve('docs/design-comparison/reference');
const browser=await chromium.launch();
try{
  for(const [name,width,height] of [['1366',1366,768],['1920',1920,1080]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    await page.goto(pathToFileURL(source).href,{waitUntil:'load'});
    await page.waitForTimeout(1200);
    const text=await page.locator('body').innerText();
    await page.screenshot({path:resolve(output,`inbox-light-${name}.png`),animations:'disabled'});
    console.log(`Claude reference ${name}: ${text.length} caracteres visibles; ${text.slice(0,140).replaceAll('\n',' ')}`);
    if(!text.includes('Activos')||!text.includes('En espera'))throw new Error('La composición Claude no se renderizó');
    for(const [screen,label] of [['metrics',/^Métricas$/],['team',/^Equipo y permisos$/],['settings',/^Configuración$/],['diagnostics',/^Diagnóstico/]]){
      const nav=page.getByRole('button',{name:label});
      if(await nav.count()===0){console.log(`Claude ${screen}: navegación no disponible en esta vista`);continue;}
      await nav.first().click();
      await page.screenshot({path:resolve(output,`${screen}-light-${name}.png`),animations:'disabled'});
      console.log(`Claude ${screen} ${name}: referencia capturada`);
    }
    await page.close();
  }
}finally{await browser.close();}

import { mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const root=resolve('.');
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=join(root,'data','backups',`visual-code-${timestamp}`);
await mkdir(backup,{recursive:true});
const paths=['app/frontend/src','app/frontend/public/brand','app/frontend/vite.config.ts','app/frontend/tsconfig.json','app/backend/src','app/backend/tsconfig.json','scripts','tests','package.json','package-lock.json','playwright.visual.config.ts'];
for(const path of paths){
  await mkdir(resolve(backup,path,'..'),{recursive:true});
  await cp(resolve(root,path),resolve(backup,path),{recursive:true,filter:source=>!/(?:^|[\\/])(?:\.env(?:\..*)?|node_modules|dist|uploads)(?:[\\/]|$)/.test(source)});
}
const results=[];
for(const command of ['npm run build','npm test']){
  const start=Date.now();let output='';
  const child=spawn('cmd.exe',['/d','/s','/c',command],{cwd:root,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
  const code=await new Promise(resolve=>child.once('exit',resolve));
  const name=command==='npm test'?'tests':'build';
  await writeFile(join(backup,`${name}.log`),output.replace(/\x1b\[[0-9;]*m/g,''));
  results.push({command,code,seconds:((Date.now()-start)/1000).toFixed(2),output});
}
await mkdir(join(root,'docs'),{recursive:true});
await writeFile(join(root,'docs','VISUAL_PARITY_BASELINE.md'),`# Visual parity functional baseline\n\nCaptured: ${new Date().toISOString()}\n\nCode backup: \`data/backups/visual-code-${timestamp}/\`\n\nBackup includes the existing frontend/backend source, scripts, tests, and package manifests. No environment files, database, credentials, uploads, or runtime logs were copied. Existing uncommitted work is preserved.\n\n${results.map(r=>`- \`${r.command}\`: **${r.code===0?'PASS':'FAIL'}**, exit ${r.code}, ${r.seconds}s. Output: backup/${r.command==='npm test'?'tests':'build'}.log.`).join('\n')}\n\n${results.find(r=>r.command==='npm test').output.match(/(?:ℹ|#) (?:tests|pass|fail) \d+/g)?.join('\n')||''}\n\n## Boundaries\n\nVisual pass changes frontend presentation and isolated visual tooling only. Backend/schema, provider contracts, routing, worker, subscriptions, tunnel and credentials are frozen. Claude HTML source is the visual authority; CAP APIs and permission checks remain the functional authority.\n\n## Visual authority\n\n\`C:/Users/PC/Downloads/WhatsApp chat management system/CAP Inbox.dc.html\`. New captures are stored separately under \`visual/reference/claude/\` and \`visual/actual/cap/\`. Previous CAP-versus-CAP zero-diff results are not parity evidence.\n\n## Skills\n\nNo frontend/Vue/design/accessibility/visual-regression skill is available in the provided catalog. No unrelated skill loaded.\n`);
console.log(`Baseline backup: ${backup}`);
process.exitCode=results.some(r=>r.code!==0)?1:0;

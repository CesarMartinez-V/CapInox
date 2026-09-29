import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const target=resolve(root,'data/backups',new Date().toISOString().replaceAll(':','-'));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const banned=/(^|\/)(\.env(?!\.example(?:\/|$))(?:\..*)?|node_modules|data|uploads|n8n\/backups|\.git)(\/|$)|\.(?:sqlite|db|log|pem|key|p12)$/i;
mkdirSync(resolve(target,'code'),{recursive:true});
let copied=0;
for(const name of files){
  const clean=name.replaceAll('\\','/');
  if(banned.test(clean))continue;
  const from=resolve(root,clean),to=resolve(target,'code',clean);
  if(!from.startsWith(`${root}${sep}`)||!existsSync(from))continue;
  mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);copied++;
}
const database=new Database(resolve(root,'data/chat.sqlite'),{readonly:true,fileMustExist:true});
try{await database.backup(resolve(target,'chat.sqlite'));}finally{database.close();}
const verify=new Database(resolve(target,'chat.sqlite'),{readonly:true,fileMustExist:true});
try{if(verify.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Backup SQLite inválido');}
finally{verify.close();}
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
writeFileSync(resolve(target,'snapshot.json'),JSON.stringify({createdAt:new Date().toISOString(),gitHead:head,codeFiles:copied,databaseIntegrity:'ok',configuration:'only non-secret tracked/allowed files; .env excluded'},null,2));
console.log(`Snapshot seguro: ${target}; ${copied} archivos, SQLite integrity_check=ok, commit=${head.slice(0,12)}`);

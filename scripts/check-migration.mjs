import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const source=resolve(import.meta.dirname,'../data/chat.sqlite');
const target=resolve('C:/Users/PC/AppData/Local/Temp/opencode',`cap-migration-${randomUUID()}.sqlite`);
const original=new Database(source,{readonly:true});
try{
  const before=original.prepare('SELECT COUNT(*) n FROM messages').get().n;
  await original.backup(target);
  const child=spawnSync(process.execPath,['--import','tsx','-e',`import('./app/backend/src/db.ts').then(({db})=>{const n=db.prepare('SELECT COUNT(*) n FROM messages').get().n;const seq=db.prepare('SELECT COUNT(*) n FROM messages WHERE sequence IS NULL').get().n;const media=db.prepare('SELECT COUNT(*) n FROM media_assets').get().n;const integrity=db.pragma('integrity_check',{simple:true});const fk=db.pragma('foreign_key_check').length;console.log(JSON.stringify({messages:n,missingSequence:seq,media,integrity,foreignKeyErrors:fk}));db.close()})`],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,DEMO_DB_PATH:target,NODE_ENV:'test'},encoding:'utf8',timeout:30000});
  if(child.status!==0)throw new Error(child.stderr.slice(0,1000));
  const line=child.stdout.trim().split('\n').at(-1);const result=JSON.parse(line);
  if(result.messages!==before||result.missingSequence||result.integrity!=='ok'||result.foreignKeyErrors)throw new Error('Migration integrity failure');
  console.log('Migración sobre copia real:',JSON.stringify(result));
}finally{original.close();await rm(target,{force:true});}

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=files.filter(path=>/(^|\/)(?:node_modules|data|uploads|backups|\.git)(\/|$)|(^|\/)\.env(?!\.example$)|\.sqlite(?:-wal|-shm)?$|\.log$|\.demo-pids\.json$/i.test(path));
const patterns=[
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{24,}/i,
  /(?:"(?:apiKey|accessToken|password|clientSecret)"\s*:\s*")[^"\s]{16,}"/i,
];
const sensitive=files.filter(path=>{
  const text=readFileSync(path,'utf8');return patterns.some(pattern=>pattern.test(text));
});
if(forbidden.length||sensitive.length){
  for(const path of forbidden)console.error('Archivo privado staged:',path);
  for(const path of sensitive)console.error('Posible secreto en:',path);
  process.exitCode=1;
}else console.log(`Auditoría OK: ${files.length} archivos staged; sin rutas privadas ni patrones de credencial.`);

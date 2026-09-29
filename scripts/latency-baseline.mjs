import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
const privateConfig=dotenv.config({path:resolve(import.meta.dirname,'../.env'),quiet:true}).parsed||{};
const db=new Database(resolve(import.meta.dirname,'../data/chat.sqlite'),{readonly:true,fileMustExist:true});
const pct=(sorted,p)=>sorted.length?Math.round(sorted[Math.ceil(sorted.length*p)-1]):null;
const summary=values=>{const sorted=values.sort((a,b)=>a-b);return {count:sorted.length,p50_ms:pct(sorted,.5),p95_ms:pct(sorted,.95),p99_ms:pct(sorted,.99)};};
try{
  const rows=db.prepare("SELECT provider_timestamp,received_at,processed_at,raw_payload,route,message_type FROM messages WHERE direction='inbound' AND received_at IS NOT NULL AND received_at>=? ORDER BY rowid DESC LIMIT 5000").all(new Date(Date.now()-86400000).toISOString());
  const external=[],processed=[],byRoute=new Map();let missingProviderTimestamp=0,invalidTimestamp=0;
  for(const row of rows){
    const receive=Date.parse(row.received_at);
    try{const raw=JSON.parse(row.raw_payload||'{}');if(typeof raw.timestamp==='string'&&raw.timestamp){const from=Date.parse(raw.timestamp);if(Number.isFinite(from)&&Number.isFinite(receive))external.push(receive-from);else invalidTimestamp++;}else missingProviderTimestamp++;}catch{invalidTimestamp++;}
    const completed=Date.parse(row.processed_at?.replace(' ','T')+'Z');
    if(Number.isFinite(completed)&&Number.isFinite(receive)){
      const duration=Math.max(0,completed-receive);processed.push(duration);
      const key=`${row.route||'NONE'}:${row.message_type||'unknown'}`;
      if(!byRoute.has(key))byRoute.set(key,[]);byRoute.get(key).push(duration);
    }
  }
  console.log(JSON.stringify({window:'last_24h',inbound:rows.length,provider_to_server:summary(external),provider_timestamp_missing:missingProviderTimestamp,provider_timestamp_invalid:invalidTimestamp,receive_to_processed_legacy_second_precision:summary(processed),processing_by_route:Object.fromEntries([...byRoute].map(([key,value])=>[key,summary(value)])),sqlite:{journalMode:db.pragma('journal_mode',{simple:true}),busyTimeoutMs:db.pragma('busy_timeout',{simple:true}),synchronous:db.pragma('synchronous',{simple:true})},config:{aiDebounceMs:Number(privateConfig.AI_MESSAGE_DEBOUNCE_MS||700),n8nOnThisMachine:/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(privateConfig.N8N_AI_WEBHOOK_URL||'')},note:'provider timestamp semantics/clock sync unverified; existing processed_at has 1-second precision; browser and tunnel delay unavailable before new tracing'}));
}finally{db.close();}

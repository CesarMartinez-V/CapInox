import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db } from './db.js';
import { storage,mediaDirectory as directory } from './storage.js';
import {mark,measure,monotonic,elapsed} from './latency.js';
import { queueRealtime } from './realtime.js';

const extensions:Record<string,string>={
  'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif',
  'audio/mpeg':'.mp3','audio/mp3':'.mp3','audio/ogg':'.ogg','audio/opus':'.opus','audio/mp4':'.m4a','audio/webm':'.webm',
  'video/mp4':'.mp4','video/webm':'.webm','application/pdf':'.pdf',
  'application/octet-stream':'.bin',
};
export const mediaDirectory=directory;
function validSignature(mime:string,head:Buffer){
  const ascii=head.toString('ascii');
  if(mime==='image/jpeg')return head[0]===0xff&&head[1]===0xd8&&head[2]===0xff;
  if(mime==='image/png')return head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/webp')return ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP';
  if(mime==='image/gif')return ascii.startsWith('GIF8');
  if(['audio/ogg','audio/opus'].includes(mime))return ascii.startsWith('OggS')||ascii.startsWith('OpusHead');
  if(['audio/mpeg','audio/mp3'].includes(mime))return ascii.startsWith('ID3')||(head[0]===0xff&&(head[1]&0xe0)===0xe0);
  if(mime==='audio/mp4'||mime==='video/mp4')return ascii.slice(4,8)==='ftyp';
  if(mime==='audio/webm'||mime==='video/webm')return head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if(mime==='application/pdf')return ascii.startsWith('%PDF');
  return mime==='application/octet-stream';
}
export function trustedProviderUrl(value:string) {
  try { const u=new URL(value);return u.protocol==='https:' && u.hostname==='storage.googleapis.com' && !u.username && !u.password && u.port===''; }
  catch { return false; }
}
export type Asset={id:string;message_id:string;mime_type:string|null;storage_path:string|null;playable_path:string|null;thumbnail_path:string|null;storage_status:string;file_name:string|null;media_size:number|null};
export const getAsset=(id:string)=>db.prepare('SELECT id,message_id,mime_type,storage_path,playable_path,thumbnail_path,storage_status,file_name,media_size FROM media_assets WHERE id=?').get(id) as Asset|undefined;

export async function downloadMedia(messageId:string) {
  const assets=db.prepare("SELECT id,provider_url FROM media_assets WHERE message_id=? AND storage_status='PENDING'").all(messageId) as Array<{id:string;provider_url:string|null}>;
  if(assets.length)mark(messageId,'media_started_at');
  const started=monotonic();
  for (const asset of assets) {
    if(!db.prepare("UPDATE media_assets SET storage_status='DOWNLOADING' WHERE id=? AND storage_status='PENDING'").run(asset.id).changes)continue;
    let output='';
    try {
      if (!asset.provider_url || !trustedProviderUrl(asset.provider_url)) throw new Error('Untrusted or absent provider URL');
      const response=await fetch(asset.provider_url,{redirect:'error',signal:AbortSignal.timeout(25000)});
      if (!response.ok || !response.body) throw new Error(`Media HTTP ${response.status}`);
      const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if (!(mime in extensions)) { await response.body.cancel(); throw new Error('Unsupported MIME'); }
      const max=config.MAX_MEDIA_MB*1024*1024;
      if (Number(response.headers.get('content-length'))>max) { await response.body.cancel(); throw new Error('Media too large'); }
      output=storage.newKey(extensions[mime]);
      let size=0,head=Buffer.alloc(0);
      const limit=new Transform({transform(chunk:Buffer,_encoding,callback){size+=chunk.length;if(head.length<16)head=Buffer.concat([head,chunk.subarray(0,16-head.length)]);callback(size>max?new Error('Media too large'):null,chunk);}});
      await pipeline(Readable.fromWeb(response.body as never),limit,storage.write(output));
      if (!size) throw new Error('Empty media');
      if(!validSignature(mime,head))throw new Error('Media MIME/signature mismatch');
      let playable:string|null=null;
      let thumbnail:string|null=null;
      if(mime.startsWith('image/')){
        const target=storage.newKey('.jpg');
        try{
          await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',storage.localPath(output),'-frames:v','1','-vf','scale=320:-1:force_original_aspect_ratio=decrease',storage.localPath(target)],{timeout:15000,maxBuffer:65536});
          if((await stat(storage.localPath(target))).size>0)thumbnail=target;
        }catch{await storage.remove(target);}
      }
      if (mime==='audio/ogg'||mime==='audio/opus') {
        const target=storage.newKey('.mp3');
        try {
          await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',storage.localPath(output),'-vn','-codec:a','libmp3lame','-qscale:a','5',storage.localPath(target)],{timeout:30000,maxBuffer:65536});
          if ((await stat(storage.localPath(target))).size>0) playable=target;
        } catch { await storage.remove(target); }
      }
      db.transaction(()=>{
        db.prepare("UPDATE media_assets SET mime_type=?,media_size=?,storage_path=?,playable_path=?,thumbnail_path=?,storage_status='READY',error=NULL WHERE id=?").run(mime,size,output,playable,thumbnail,asset.id);
        db.prepare("UPDATE messages SET media_url=?,mime_type=?,media_size=?,storage_path=?,storage_status='READY' WHERE id=? AND media_url IS NULL").run(`/api/media/${asset.id}`,mime,size,output,messageId);
        const conv=db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(messageId) as {conversation_id:string};
        queueRealtime('media.ready',conv.conversation_id,messageId);
      })();
    } catch (err) {
      if (output && storage.exists(output)) await storage.remove(output);
      db.prepare("UPDATE media_assets SET storage_status='FAILED',error=? WHERE id=?").run(err instanceof Error?err.message.slice(0,100):'download failed',asset.id);
      db.prepare("UPDATE messages SET storage_status='FAILED' WHERE id=? AND media_url IS NULL").run(messageId);
      const conv=db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(messageId) as {conversation_id:string}|undefined;
      if(conv)queueRealtime('media.ready',conv.conversation_id,messageId);
    }
  }
  if(assets.length){mark(messageId,'media_completed_at');measure(messageId,'media_ms',elapsed(started));}
}

export async function retryMedia(messageId:string) {
  db.prepare("UPDATE media_assets SET storage_status='PENDING',error=NULL WHERE message_id=? AND storage_status='FAILED'").run(messageId);
  await downloadMedia(messageId);
}

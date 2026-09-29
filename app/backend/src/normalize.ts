import { z } from 'zod';

const envelope = z.object({ event: z.string(), eventId:z.string().optional(), timestamp: z.string().optional(), locationId: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional() }).passthrough();
export type Media = { url: string; mimeType?: string; fileName?: string; size?: number; latitude?: number; longitude?: number; providerMediaId?:string; duration?:number; caption?:string; thumbnail?:string };
export type Normalized = {
  eventType: string; eventId:string|null; messageId: string | null; contactId: string | null; conversationId: string | null;
  phone: string | null; customerName: string | null; direction: 'inbound' | 'outbound' | 'other';
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'unknown';
  text: string; media: Media | null; attachments:Media[]; timestamp: string; raw: unknown;
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : null;
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const types = new Set(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact']);

/** Real provider media is message.media: [{url,type}]. Optional metadata is read only if present. */
export function normalizeProviderEvent(input: unknown): Normalized {
  const root = envelope.parse(input);
  const p = obj(root.payload);
  const contact = obj(p.contact);
  const message = obj(p.message);
  const entries=Array.isArray(message.media)?message.media:message.media?[message.media]:[];
  const attachments:Media[]=entries.filter(x=>x && typeof x==='object' && !Array.isArray(x)).map(x=>{
    const m=obj(x);return {url:str(m.url)||'',mimeType:str(m.mimeType)||undefined,fileName:str(m.fileName)||undefined,
      size:num(m.size),providerMediaId:str(m.id)||undefined,duration:num(m.duration),caption:str(m.caption)||undefined,thumbnail:str(m.thumbnail)||undefined,
      latitude:num(m.latitude),longitude:num(m.longitude)};
  });
  const mediaType=str(obj(entries[0]).type)?.toLowerCase();
  const kind=(str(message.type)?.toLowerCase() || (mediaType?.split('/')[0]) || (str(message.text)?'text':'unknown'));
  const first=attachments[0];
  const latitude=first?.latitude ?? num(message.latitude),longitude=first?.longitude ?? num(message.longitude);
  const media:Media|null=first || (kind==='location'&&latitude!==undefined&&longitude!==undefined?{url:'',latitude,longitude}:null);
  return {
    eventType: root.event,
    eventId:str(root.eventId),
    messageId: str(p.messageId), contactId: str(contact.id), conversationId: str(p.conversationId),
    phone: str(contact.number), customerName: str(contact.name),
    direction: root.event === 'whatsapp.inbound' ? 'inbound' : root.event === 'whatsapp.outbound' ? 'outbound' : 'other',
    messageType: (types.has(kind) ? kind : 'unknown') as Normalized['messageType'],
    text: str(message.text) || '', media, attachments, timestamp: root.timestamp || new Date().toISOString(), raw: input,
  };
}

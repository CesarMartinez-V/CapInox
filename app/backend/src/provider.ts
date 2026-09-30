import { config } from './config.js';
import { z } from 'zod';

export const providerBase = 'https://api.messagesync.ai/v1'; // n8n-nodes-message-sync-ai@0.1.3/dist/nodes/MessageSyncAi/config.js
export function publicWebhookBase(value=config.PUBLIC_WEBHOOK_URL){
  if(!value)throw new Error('Stable public webhook tunnel is not configured.');
  const url=new URL(value);
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash||url.pathname!=='/'||
    ['localhost','127.0.0.1'].includes(url.hostname)||url.hostname.endsWith('.trycloudflare.com')&&(process.env.NODE_ENV==='production'||(config.DEV_ALLOW_QUICK_TUNNEL!=='true'&&config.QUICK_TUNNEL_ALLOWED!=='true')))
    throw new Error('PUBLIC_WEBHOOK_URL must be a stable public HTTPS origin.');
  return url.origin;
}
export function expectedWebhookTarget(base=publicWebhookBase()){
  if(config.WEBHOOK_INGRESS_SECRET.length<32)throw new Error('WEBHOOK_INGRESS_SECRET requerido');
  return `${base}/webhooks/messagesync/${encodeURIComponent(config.WEBHOOK_INGRESS_SECRET)}`;
}
const responseSchema = z.object({}).passthrough();
export class ProviderHttpError extends Error {constructor(public readonly status:number){super(`MessageSync HTTP ${status}`);}}

async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: object) {
  if (!config.MESSAGESYNC_API_KEY || !config.GHL_LOCATION_ID) throw new Error('MessageSync no configurado');
  const res = await fetch(`${providerBase}${path}`, {
    method, headers: { Authorization: `Bearer ${config.MESSAGESYNC_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  // Deliberately do not log the request, headers, or raw response.
  if (!res.ok) throw new ProviderHttpError(res.status);
  if (method === 'DELETE') return {};
  return responseSchema.parse(await res.json());
}

export async function sendWhatsapp(contactId: string, message: string, attachments: string[] = []) {
  if (!contactId || (!message && !attachments.length)) throw new Error('Destinatario o contenido ausente');
  return request('/whatsapp/outbound', 'POST', {
    // This source value is what the installed node sends; it is provider metadata, not an n8n execution.
    locationId: config.GHL_LOCATION_ID, contactId, message, attachments, source: 'n8n',
  });
}

export async function listSubscriptions(): Promise<Array<Record<string, unknown>>> {
  const result = await request(`/webhooks/subscriptions?locationId=${encodeURIComponent(config.GHL_LOCATION_ID)}`, 'GET');
  return Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
}

export async function ensureSubscription(publicUrl: string) {
  const targetUrl = expectedWebhookTarget(publicWebhookBase(publicUrl));
  const existing = (await listSubscriptions()).find(s => s.description==='web-demo-human-console'&&s.targetUrl === targetUrl && Array.isArray(s.events) && ['whatsapp.inbound', 'whatsapp.outbound'].every(e => (s.events as unknown[]).includes(e)));
  if (existing) return { status: 'existing', id: existing.id };
  const result = await request('/webhooks/subscriptions', 'POST', {
    locationId: config.GHL_LOCATION_ID, targetUrl,
    events: ['whatsapp.inbound', 'whatsapp.outbound'],
    description: 'web-demo-human-console', testPing: false,
  });
  return { status: 'created', id: result.id };
}

/** Rotate only CAP-owned subscriptions, never subscriptions created by n8n or other applications. */
export async function syncOwnedSubscription(publicUrl: string) {
  const base = publicWebhookBase(publicUrl);
  const reachable=await fetch(`${base}/health/live`,{signal:AbortSignal.timeout(5000)}).catch(()=>null);
  if(!reachable?.ok||!reachable.headers.get('content-type')?.includes('application/json')||(await reachable.json()).backend!=='online')throw new Error('CAP public health is not reachable; subscription unchanged');
  const result = await ensureSubscription(base);
  let subscriptions = await listSubscriptions();
  const owned = subscriptions.filter(s => s.description === 'web-demo-human-console');
  const current = owned.filter(s => s.targetUrl === expectedWebhookTarget(base));
  if (current.length !== 1) throw new Error('Suscripción nueva no confirmada o duplicada; no se eliminó la anterior');
  for (const stale of owned.filter(s => s.id !== current[0].id)) {
    if (typeof stale.id !== 'string') throw new Error('Suscripción anterior sin ID');
    // DELETE route is the one used by n8n-nodes-message-sync-ai@0.1.3's trigger.
    await request(`/webhooks/subscriptions/${encodeURIComponent(stale.id)}?locationId=${encodeURIComponent(config.GHL_LOCATION_ID)}`, 'DELETE');
  }
  subscriptions = await listSubscriptions();
  if (subscriptions.filter(s => s.description === 'web-demo-human-console').length !== 1) throw new Error('La rotación no dejó una sola suscripción propia');
  return { status: result.status, owned: 1, otherSubscriptions: subscriptions.length - 1 };
}

import { config } from './config.js';
import { z } from 'zod';

export const providerBase = 'https://api.messagesync.ai/v1'; // n8n-nodes-message-sync-ai@0.1.3/dist/nodes/MessageSyncAi/config.js
const responseSchema = z.object({}).passthrough();

async function request(path: string, method: 'GET' | 'POST', body?: object) {
  if (!config.MESSAGESYNC_API_KEY || !config.GHL_LOCATION_ID) throw new Error('MessageSync no configurado');
  const res = await fetch(`${providerBase}${path}`, {
    method, headers: { Authorization: `Bearer ${config.MESSAGESYNC_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  // Deliberately do not log the request, headers, or raw response.
  if (!res.ok) throw new Error(`MessageSync HTTP ${res.status}`);
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
  if (!config.WEBHOOK_INGRESS_SECRET || config.WEBHOOK_INGRESS_SECRET.length < 32) throw new Error('WEBHOOK_INGRESS_SECRET requerido (>=32 caracteres)');
  const base = new URL(publicUrl);
  if (base.protocol !== 'https:' || !base.hostname || base.hostname === 'localhost' || base.hostname === '127.0.0.1') throw new Error('PUBLIC_URL debe ser la URL pública HTTPS del túnel');
  const targetUrl = `${publicUrl.replace(/\/$/, '')}/webhooks/messagesync/${encodeURIComponent(config.WEBHOOK_INGRESS_SECRET)}`;
  const existing = (await listSubscriptions()).find(s => s.targetUrl === targetUrl && Array.isArray(s.events) && ['whatsapp.inbound', 'whatsapp.outbound'].every(e => (s.events as unknown[]).includes(e)));
  if (existing) return { status: 'existing', id: existing.id };
  const result = await request('/webhooks/subscriptions', 'POST', {
    locationId: config.GHL_LOCATION_ID, targetUrl,
    events: ['whatsapp.inbound', 'whatsapp.outbound'],
    description: 'web-demo-human-console', testPing: false,
  });
  return { status: 'created', id: result.id };
}

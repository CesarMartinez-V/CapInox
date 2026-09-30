import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// dotenv is resolved relative to the project, regardless of the caller's cwd.
import dotenv from 'dotenv';
dotenv.config({ path: resolve(root, '.env'), override: true, quiet: true });

const env = z.object({
  PORT: z.coerce.number().int().min(1).default(3100),
  ADMIN_USER: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default(''),
  MESSAGESYNC_API_KEY: z.string().default(''),
  GHL_LOCATION_ID: z.string().default(''),
  PUBLIC_WEBHOOK_URL: z.string().default(''),
  CLOUDFLARE_TUNNEL_NAME: z.string().default(''),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().default(''),
  QUICK_TUNNEL_ALLOWED: z.enum(['true','false']).default('false'),
  DEV_ALLOW_QUICK_TUNNEL: z.enum(['true','false']).default('false'),
  AUTO_REGISTER_WEBHOOK: z.enum(['true','false']).default('false'),
  WEBHOOK_INGRESS_SECRET: z.string().default(''),
  N8N_AI_WEBHOOK_URL: z.string().default(''),
  N8N_INTERNAL_TOKEN: z.string().default(''),
  ENABLE_AI_VISION: z.enum(['true', 'false']).default('false'),
  ENABLE_AUDIO_TRANSCRIPTION: z.enum(['true', 'false']).default('false'),
  BOT_SESSION_TIMEOUT_MINUTES: z.coerce.number().positive().default(30),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
  MAX_MEDIA_MB: z.coerce.number().positive().default(20),
  AI_MESSAGE_DEBOUNCE_MS: z.coerce.number().int().min(0).max(10000).default(700),
  INBOUND_POLL_MS: z.coerce.number().int().min(50).max(1000).default(100),
  OUTBOUND_POLL_MS: z.coerce.number().int().min(50).max(1000).default(150),
  MEDIA_POLL_MS: z.coerce.number().int().min(100).max(2000).default(500),
  WORKER_HIGH_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
  WORKER_AI_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  AI_MAX_CALLS_PER_MINUTE_PER_CONTACT: z.coerce.number().int().min(1).default(12),
  AUTO_ASSIGN_HUMAN: z.enum(['true','false']).default('false'),
  AGENT_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(15).default(90),
  HANDOFF_NO_AGENT_POLICY: z.enum(['AI_FALLBACK','WAIT_QUEUE']).default('AI_FALLBACK'),
  AGENT_DISCONNECT_GRACE_SECONDS: z.coerce.number().int().min(15).default(120),
  WARN_WAIT_SECONDS: z.coerce.number().int().min(1).default(60),
  CRITICAL_WAIT_SECONDS: z.coerce.number().int().min(1).default(180),
  OUTBOUND_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_DRIVER: z.enum(['sqlite','postgres']).default('sqlite'),
  QUEUE_DRIVER: z.enum(['database','redis']).default('database'),
}).parse(process.env);
// A Quick Tunnel origin is shared by the dev supervisor with backend/worker.
// Never persist an ephemeral URL or credentials into the public configuration.
if(process.env.NODE_ENV!=='production'&&env.DEV_ALLOW_QUICK_TUNNEL==='true'&&process.env.CAP_DEV_PUBLIC_URL){
  const origin=new URL(process.env.CAP_DEV_PUBLIC_URL);
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.trycloudflare.com')||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw new Error('Invalid development tunnel origin');
  env.PUBLIC_WEBHOOK_URL=origin.origin;
}
if (env.DATABASE_DRIVER !== 'sqlite' || env.QUEUE_DRIVER !== 'database') throw new Error('Solo sqlite y cola database están implementados en esta demo');
export const config = env;
export type Menu = {
  welcome: string; invalid: string;
  options: Record<string, { intent: string; reply: string }>;
  claim: string; noAgent:string; returnToBot: string; close: string; image: string; audio: string; video: string; aiFailure: string; aiFailureNoAgent:string;aiFlood:string;
  quickReplies: string[];
};
const menuSchema = z.object({
  welcome: z.string().min(1), invalid: z.string().min(1),
  options: z.record(z.string(), z.object({ intent: z.string(), reply: z.string().min(1) })),
  claim: z.string(), noAgent:z.string(),returnToBot: z.string(), close: z.string(), image: z.string(), audio: z.string(), video: z.string(),
  aiFailure: z.string(), aiFailureNoAgent:z.string(),aiFlood:z.string(), quickReplies: z.array(z.string()),
});
export function getMenu(): Menu {
  return menuSchema.parse(JSON.parse(readFileSync(resolve(root, 'config/menu.json'), 'utf8')));
}

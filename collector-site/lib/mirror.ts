import { env } from 'cloudflare:workers';

type MirrorPath = '/api/ingest' | '/api/catalog' | '/api/system';
export function mirrorStatement(path: MirrorPath, payload: unknown) {
 if (!env.RADAR_MIRROR_ORIGIN || !env.RADAR_MIRROR_TOKEN || !env.DB) return null;
 const at = new Date().toISOString();
 return env.DB.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').bind(
  `mirror:${at}:${crypto.randomUUID()}`, JSON.stringify({ path, payload }), at,
 );
}
export async function deliverMirror() {
 if (!env.RADAR_MIRROR_ORIGIN || !env.RADAR_MIRROR_TOKEN || !env.DB) return { configured: false, delivered: 0, pending: 0 };
 const origin = new URL(env.RADAR_MIRROR_ORIGIN);
 if (origin.origin !== 'https://product-radar-gules.vercel.app') throw new Error('Unexpected mirror destination');
 const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key LIKE 'mirror:%' ORDER BY key LIMIT 50").all<{key:string,value:string}>();
 let delivered = 0;
 for (const row of rows.results) {
  const { path, payload } = JSON.parse(row.value) as {path: MirrorPath; payload: unknown};
  if (!['/api/ingest','/api/catalog','/api/system'].includes(path)) throw new Error('Invalid mirror path');
  try {
   const response = await fetch(new URL(path, origin), {
    method: path === '/api/system' ? 'PUT' : 'POST',
    headers: {'Content-Type':'application/json','x-vercel-protection-bypass':env.RADAR_MIRROR_TOKEN},
    body: JSON.stringify(payload), redirect:'error', signal:AbortSignal.timeout(15000),
   });
   if (!response.ok) break;
   await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(row.key).run();
   delivered++;
  } catch { break; }
 }
 const row = await env.DB.prepare("SELECT COUNT(*) AS pending FROM settings WHERE key LIKE 'mirror:%'").first<{pending:number}>();
 return {configured:true,delivered,pending:row?.pending || 0};
}

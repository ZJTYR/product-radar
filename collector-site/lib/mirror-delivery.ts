export type MirrorPath = '/api/ingest' | '/api/catalog' | '/api/system';
type MirrorEnvironment = { RADAR_MIRROR_ORIGIN?: string; RADAR_MIRROR_TOKEN?: string; DB?: D1Database };

// 兼容已入队的整库快照；仅 catalog 可分批，ingest 必须保留完整一期语义。
export function mirrorPayloadBatches(path: MirrorPath, payload: unknown): unknown[] {
 if (path !== '/api/catalog' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return [payload];
 const value = payload as Record<string, unknown>;
 if (!Array.isArray(value.items) || value.items.length <= 50) return [payload];
 const batches: unknown[] = [];
 for (let index = 0; index < value.items.length; index += 50) batches.push({ ...value, items: value.items.slice(index, index + 50) });
 return batches;
}

export async function deliverMirrorQueue(env: MirrorEnvironment, send: typeof fetch = fetch) {
 if (!env.RADAR_MIRROR_ORIGIN || !env.RADAR_MIRROR_TOKEN || !env.DB) return { configured: false, delivered: 0, pending: 0 };
 const origin = new URL(env.RADAR_MIRROR_ORIGIN);
 if (origin.origin !== 'https://product-radar-gules.vercel.app') throw new Error('Unexpected mirror destination');
 const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key LIKE 'mirror:%' ORDER BY key LIMIT 50").all<{key:string,value:string}>();
 let delivered = 0;
 let failure: { path: MirrorPath; status?: number; reason: string } | null = null;
 delivery: for (const row of rows.results) {
  const { path, payload } = JSON.parse(row.value) as {path: MirrorPath; payload: unknown};
  if (!['/api/ingest','/api/catalog','/api/system'].includes(path)) throw new Error('Invalid mirror path');
  try {
   for (const batch of mirrorPayloadBatches(path, payload)) {
   const response = await send(new URL(path, origin), {
    method: path === '/api/system' ? 'PUT' : 'POST',
    headers: {'Content-Type':'application/json','x-vercel-protection-bypass':env.RADAR_MIRROR_TOKEN},
    // Workers 不支持 error；manual 保留 3xx，再按非成功状态拒绝，避免转发凭证。
    body: JSON.stringify(batch), redirect:'manual', signal:AbortSignal.timeout(15000),
   });
   if (!response.ok) {
    failure = { path, status: response.status, reason: 'destination_rejected' };
    break delivery;
   }
   }
   await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(row.key).run();
   delivered++;
  } catch (error) {
   // 仅返回错误类别，不输出请求头、凭证或待同步内容。
   failure = { path, reason: error instanceof Error ? error.name : 'transport_error' };
   break;
  }
 }
 const row = await env.DB.prepare("SELECT COUNT(*) AS pending FROM settings WHERE key LIKE 'mirror:%'").first<{pending:number}>();
 return {configured:true,delivered,pending:row?.pending || 0,failure};
}

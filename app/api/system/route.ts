import { database, route, json, checkMutation, body, now } from '@/lib/server';
import { systemSchema } from '@/lib/validation';
export const dynamic = 'force-dynamic';
// Both routes rely on the Site owner-private access boundary; no service credentials are stored or returned here.
export function GET() { return route(async()=> { const rows=await database().prepare("SELECT key,value FROM settings WHERE key IN ('schedule_status','schedule_id','schedule_updated_at')").all<{key:string,value:string}>(); return json({settings:Object.fromEntries(rows.results.map(r=>[r.key,r.value]))}); }); }
export function PUT(request: Request) { return route(async()=> { checkMutation(request); const value=systemSchema.parse(await body(request)); const at=now(); const queries=Object.entries(value).filter((entry): entry is [string,string]=>typeof entry[1]==='string').map(([key,v])=>database().prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,v,at)); if(queries.length) await database().batch(queries); return json({ok:true,settings:value}); }); }

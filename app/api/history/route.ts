import { database, initialize, route, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET() { return route(async () => { await initialize(); const rows = await database().prepare('SELECT * FROM editions ORDER BY date DESC LIMIT 365').all<{date:string,payload:string,updated_at:string,status:string}>(); return json({days:rows.results.map(r=>({date:r.date,count:JSON.parse(r.payload).length,updatedAt:r.updated_at,status:r.status}))}); }); }

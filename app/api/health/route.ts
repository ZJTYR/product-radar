import { database, initialize, route, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET() { return route(async()=> {
 await initialize();
 const row=await database().prepare('SELECT CURRENT_TIMESTAMP as "databaseTime",(SELECT COUNT(*) FROM intel_items) as items,(SELECT COUNT(*) FROM editions) as editions').first<{databaseTime:string,items:string|number,editions:string|number}>();
 return json({ok:true,databaseTime:row?.databaseTime,items:Number(row?.items),editions:Number(row?.editions)});
}); }

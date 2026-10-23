import { checkMutation, database, json, route } from '@/lib/server';
import { deliverMirror } from '@/lib/mirror';
export const dynamic = 'force-dynamic';
// This endpoint inherits the existing owner-private Sites gate.
export function POST(request: Request) { return route(async () => { checkMutation(request); return json(await deliverMirror()); }); }
export function GET() { return route(async () => {
 const row = await database().prepare("SELECT COUNT(*) AS pending FROM settings WHERE key LIKE 'mirror:%'").first<{pending:number}>();
 return json({pending:row?.pending || 0,destination:'https://product-radar-gules.vercel.app'});
}); }

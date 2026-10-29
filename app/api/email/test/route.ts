import { body, checkMutation, currentUser, database, json } from '@/lib/server';
import { emailRequestSchema, sendTestEmail } from '@/lib/email-store';
import { emailRoute } from '@/lib/email-route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function POST(request: Request) { return emailRoute(async () => { checkMutation(request); const user = await currentUser(); const { requestId } = emailRequestSchema.parse(await body(request)); return json(await sendTestEmail(database(), user.userId, requestId)); }); }

import { body, checkMutation, currentUser, database, json } from '@/lib/server';
import { emailRetrySchema, retryEmail } from '@/lib/email-store';
import { emailRoute } from '@/lib/email-route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function POST(request: Request) { return emailRoute(async () => { checkMutation(request); const user = await currentUser(); const { deliveryId } = emailRetrySchema.parse(await body(request)); return json(await retryEmail(database(), user.userId, deliveryId)); }); }

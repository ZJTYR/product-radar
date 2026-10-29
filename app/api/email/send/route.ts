import { body, checkMutation, currentUser, database, HttpError, json, shanghaiDate } from '@/lib/server';
import { emailSendSchema, sendDailyEmail } from '@/lib/email-store';
import { emailRoute } from '@/lib/email-route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function POST(request: Request) { return emailRoute(async () => { checkMutation(request); const user = await currentUser(); emailSendSchema.parse(await body(request)); const result = await sendDailyEmail(database(), user.userId, shanghaiDate(), { automatic: false }); if ('skipped' in result) throw new HttpError(409, result.reason); return json(result); }); }

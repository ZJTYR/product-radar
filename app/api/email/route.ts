import { currentUser, database, json } from '@/lib/server';
import { emailStatus } from '@/lib/email-store';
import { emailRoute } from '@/lib/email-route';
import { emailScheduleStatus } from '@/lib/email-schedule-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function GET() { return emailRoute(async () => { const user = await currentUser(); return json({ ...await emailStatus(database(), user.userId), schedule: await emailScheduleStatus(database(), user.userId, { inspect: true }) }); }); }

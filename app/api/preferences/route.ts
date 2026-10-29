import { database, currentUser, route, json, checkMutation, body, emailConfigured, HttpError } from '@/lib/server';
import { preferenceSchema } from '@/lib/validation';
import { emailReadiness } from '@/lib/email-smtp';
import { DEFAULT_DELIVERY_TIME } from '@/lib/email-timing';
import { emailScheduleStatus, saveEmailPreferences, storedEmailPreferences } from '@/lib/email-schedule-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function GET() { return route(async()=> {
 const user=await currentUser();
 const preferences=await storedEmailPreferences(database(),user.userId) || {email:user.email,deliveryTime:DEFAULT_DELIVERY_TIME,emailEnabled:false};
 return json({preferences,emailConfigured:emailConfigured(),...emailReadiness(),schedule:await emailScheduleStatus(database(),user.userId,{inspect:true})});
}); }
export function PUT(request: Request) { return route(async()=> {
 checkMutation(request);
 const user=await currentUser();
 const prefs=preferenceSchema.parse(await body(request));
 if(prefs.emailEnabled&&!emailConfigured()) throw new HttpError(409,'SMTP 发信配置尚未完整，暂不能开启每日邮件');
 const schedule=await saveEmailPreferences(database(),user.userId,prefs);
 return json({preferences:await storedEmailPreferences(database(),user.userId) || prefs,emailConfigured:emailConfigured(),...emailReadiness(),schedule});
}); }

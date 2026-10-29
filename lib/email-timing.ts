export const DEFAULT_DELIVERY_TIME = '20:00';
export const EMAIL_TIME_ZONE = 'Asia/Shanghai';
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validEmailTime(value: string): boolean { return timePattern.test(value); }
export function emailDay(at: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EMAIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
export function emailTime(at: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: EMAIL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}
/** 只判断当天是否到时；是否开启、简报日期和投递去重由发送状态机核对。 */
export function isEmailDue(deliveryTime: string, at: string): boolean {
  return validEmailTime(deliveryTime) && emailTime(at) >= deliveryTime;
}

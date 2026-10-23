/** 单人私有工作台：线上所有域名均由 Vercel Authentication 保护。
 * 不信任浏览器传入的 oai-* / 用户身份头；不得关闭生产部署保护。
 */
export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
 if (process.env.VERCEL && process.env.RADAR_OWNER_PRIVATE !== 'true') return null;
 if (!process.env.VERCEL && process.env.NODE_ENV === 'production' && process.env.RADAR_LOCAL_TEST !== 'true') return null;
 return { userId: 'github:107673736', displayName: 'ZJTYR', email: process.env.RADAR_OWNER_EMAIL || '', fullName: null };
}

import Radar from '@/components/radar/radar';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
 const user = await getChatGPTUser();
 if (!user) return <main style={{padding:40}}>工作台访问保护尚未配置，请联系站点所有者。</main>;
 return <Radar />;
}

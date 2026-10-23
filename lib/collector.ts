import type { IntelItem } from './types';

export async function refreshRepositoryStars(items: IntelItem[]) {
 const errors: string[]=[]; let checked=0;
 const updated=await Promise.all(items.map(async item=>{
  if (!item.repo) return item;
  try {
   const response=await fetch(`https://api.github.com/repos/${item.repo}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Product-Radar'},signal:AbortSignal.timeout(12000)});
   if(!response.ok) throw new Error(`HTTP ${response.status}`);
   const repo=await response.json() as {stargazers_count?:number};
   if(typeof repo.stargazers_count!=='number') throw new Error('缺少 Star 数据');
   checked++; return {...item,stars:repo.stargazers_count,starsCheckedAt:new Date().toISOString()};
  } catch(error) { errors.push(`${item.name}: ${error instanceof Error?error.message:'来源暂不可用'}`); return item; }
 }));
 return {items:updated,errors,checked,partial:errors.length>0};
}

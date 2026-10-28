import { collectionPolicy, collectionRules } from '@/lib/collection-policy';
import { database, initialize, route, json, shanghaiDate } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET() { return route(async()=> { await initialize(); const rows=await database().prepare('SELECT id,payload FROM intel_items').all<{id:string,payload:string}>(); return json({
 title:'产品雷达每日编辑更新指南', date:shanghaiDate(),timezone:'Asia/Shanghai',
 collectionPolicy,
 instructions:[
 "先读取 /api/feed 与本指南，按 id、产品官网、GitHub repo、事件日期检查已有内容；同一事件沿用稳定 id，不重复创建。",
 ...collectionRules,
 "持续维护跨行业合格产品候选库，以首页8条展示和至少16条备选为储备目标，不为数量牺牲质量。GitHub高关注只是候选方向之一；先检查已有记录并去重，按实质新变化或新发现的使用价值补充，成熟产品保留真实发现日期。产品库可用 POST /api/catalog 写入 {items:[完整IntelItem]}（1—50条、按id更新），不改变历史简报或用户收藏；当天有新动态的产品仍通过 /api/ingest 纳入本期。",
 "POST /api/ingest 写入 {date,items,status}；items 是当天完整清单而不是增量补丁，最多20条。可对同日重放，库内容按 id 更新，用户收藏和备注独立保存。禁止未来日期。历史已有快照仅允许相同内容重放，不能覆盖；新发现写入当天。",
 "写入后 GET /api/feed?date=日期 与 /api/health 核对条数、日期、来源及已入库内容；回报实际新增/更新和失败来源。",
 "服务访问使用 Sites 支持的 owner-private service access。凭证只放请求头，不写入源码、提示词或结果。不得改变站点可见性。",
 "当前邮箱收集与偏好可保存，邮件自动投递未接通，不得声称已向用户发送邮件。",
 ],
 existing:rows.results.map(r=>{const v=JSON.parse(r.payload);const imageCount=new Set([v.image,...(v.images??[]).map((image:{url:string})=>image.url)].filter(Boolean)).size;return{id:r.id,name:v.name,website:v.website,repo:v.repo,kind:v.kind,aiApplication:v.aiApplication,newsTopic:v.newsTopic,discoveredAt:v.discoveredAt,publishedAt:v.publishedAt,imageCount,missingImages:imageCount===0};}),
 media:{scope:'product | design | ai | news，统一多图采集',target:'有可靠资料时争取5—12张不同内容图片，有更多价值时继续收集，images最多50张；不凑数',existingCounts:'imageCount按legacy image与images[].url去重计数；missingImages仅表示当前未收录URL，不代表实时外链检查',cover:'保留legacy image优先作封面；同URL采用images里的说明与来源；只有images时用第一张作封面',catalogUpdate:'先读取完整旧记录，合并新图与原画廊并去重核验；POST /api/catalog {items:[完整IntelItem]}，非局部补丁；保留原有事实、来源、publishedAt与discoveredAt，不修改历史简报',imageFields:{url:'公开http(s)图片URL或已有/images/路径',caption:'必填，1—300字符，功能与类型，能核验时注明版本/时间',sourceUrl:'必填http(s)原始来源页面URL'}},
 ingest:{method:'POST',path:'/api/ingest',body:{date:'YYYY-MM-DD',status:'complete | partial',items:'IntelItem[]，允许0—20条'},itemSchema:{
 id:'稳定ASCII标识，1—100位，字母数字下划线连字符',kind:'product | design | ai | news',newsTopic:'kind=news必填：technology科技动态 | product产品热点，并保留实际publishedAt；长期产品介绍仍用kind=product',aiApplication:'AI应用层分类：agents | knowledge | multimodal | integration | engineering；AI前沿候选必须填写，旧记录兼容省略',name:'产品名',title:'小白能看懂的一句话：这是什么、能做什么',subtitle:'一句话定位',summary:'背景：为什么人们会需要它',category:'类别',tags:['标签'],image:'可选：已有 /images/ 路径或真实公开图片URL',imageCaption:'可选：兼容旧封面，准确说明图片类型与内容',images:[{url:'可选画廊：已有/images/路径或真实公开http(s)图片URL；最多50张，同URL不重复',caption:'每图必填，1—300字符：展示的功能、图片类型和已知版本，旧图不冒充新功能截图',sourceUrl:'每图必填：http(s)原始页面URL，该页面实际承载或引用此图'}],accent:'色值',website:'http(s)官方URL',github:'可选http(s)仓库URL',repo:'可选owner/repo',stars:'可选非负整数或null；不可猜测',starsCheckedAt:'可选ISO时间',publishedAt:'ISO时间或null',discoveredAt:'首次发现ISO时间',evidence:'官方资料 | 产品观察 | 官方发布',featured:'可选boolean',readMinutes:'1—120整数',facts:['可追溯的事实与数据，展示在资料区'],audience:'具体使用者',pain:'没有产品时遇到什么麻烦',scenario:'可选：标注为使用示例的具体场景，不虚构客户证言',workflow:'3—5个具体步骤，用 → 分隔',businessModel:'谁付费、为哪些服务付费；公开信息与分析分开',differentiation:'对用户的价值与必要差异，不虚构指标',opportunity:'我们可以借鉴什么，明确标注产品推断/待验证',designNotes:['具体设计亮点'],caveats:['首条优先说明真实使用门槛，其余限制与未验证信息'],sources:[{label:'来源名称',url:'http(s)可访问原始URL'}]
 }}
 }); }); }

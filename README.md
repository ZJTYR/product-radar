# 拾光 · 产品情报工作台

面向产品经理的跨行业产品研究、商业分析、设计灵感与每日简报。保留搜索、10 个 GitHub 高关注候选、通俗产品详情、收藏分类和备注、历史快照与手机布局。

- 工作台：https://product-radar-gules.vercel.app/
- 个人私有仓库：https://github.com/ZJTYR/product-radar
- Vercel：qyh's projects / product-radar，生产分支 main。

## 访问与数据

所有域名均要求 Vercel 登录；使用创建项目的个人账号访问。当前是单人工作台，稳定所有者为 `github:107673736`。**必须保持 Vercel Authentication = All Deployments，不能关闭或授予其他人访问。** `RADAR_OWNER_PRIVATE=true` 是部署配置检查，不是独立鉴权。未来公开或多人使用须先增加应用登录和逐用户授权。

生产数据保存在 Neon 免费套餐的 Postgres 中，功能部署不会清空收藏和历史。采用参数化查询及数据库事务。2026-10-23 从原站导入 21 条资料、2 期快照和已有偏好；个人数据与导出文件不进入 Git。

## 本地运行

需要 Node.js 24 和 npm。

```sh
npm ci
npm run dev -- --hostname 127.0.0.1 --port 5187
```

访问 http://127.0.0.1:5187/ 。未设置 DATABASE_URL 时，本地使用 `.local/radar.sqlite`；Vercel 环境禁止退回本地文件数据库。首次初始化只加载注明原始日期的种子资料，不冒充今日简报。

```sh
npm run lint
npm run check
```

生产 DATABASE_URL 由 Neon/Vercel 注入，RADAR_OWNER_PRIVATE 和 RADAR_OWNER_EMAIL 只在服务端配置。`.env.example` 仅列变量名称。不上传真实 .env、.vercel、数据库或私有导出文件。

## 持续交付

根目录是标准 Next.js 应用。GitHub Actions 对提交和 PR 运行类型检查、测试、构建与 lint；Vercel 原生 Git 集成订阅本仓库，main 的新提交自动产生生产部署并更新固定地址。

完成改动后，按 AGENTS.md 核验 ZJTYR 身份、推送功能分支、等待 CI、正常合并 PR 并检查 Vercel 对应提交。CI 与 Vercel 构建是独立状态，必须分别核验，不能只凭 push 成功声称已上线。

## 每日内容更新

统一策略见 [采集规则](docs/采集规则.md)，运行时真源为 `lib/collection-policy.ts`，通过 `/api/update-guide` 输出。Moonvy 用于设计灵感与产品发现；GitHub 增加 AI 创作产品与解决实际问题的完整方案，按产品价值、维护、使用门槛和证据筛选。

既有 Sites 云任务继续于北京时间每天 08:30 研究公开来源，避免创建重复采集：

1. 云任务读取原站 `/api/update-guide`，写入产品库和当天完整简报。
2. 原站在同一事务内保存内容与待同步记录，再用仅服务端保存的凭证发送到 Vercel 的 `/api/catalog`、`/api/ingest`。
3. 新工作台写入 Neon，无需重新构建就能看到内容。失败记录留在原站队列，任务通过 `/api/sync` 重试并核对 pending=0。
4. Codex 09:00 提醒读取实际日期与同步状态，链接到新工作台；失败时明确提示，不把旧内容报作今日完成。

原采集服务：https://product-radar-qyh.true-owl-2183.chatgpt.site/ ，保持 owner-private。`collector-site/` 保存其完整源码，基线 Sites commit 为 `905fa09993613daefc7d160382e34c52bc2facfc`。UI 来源为 Sites commit `982de7ee0655896407452dced4864dc8d6c5c333`，根目录适配了运行时、数据库与私人访问。

根目录功能更新由 Git 自动部署 Vercel；修改 collector-site 云采集服务仍须按 Sites source helper 流程单独发布，并核对源码一致。仅推送 GitHub 不会发布 Sites。

## 备份与迁移

原站 `/api/export` 在 owner-private 边界内提供数据备份。凭证仅放请求头，不进入文件、命令参数或日志。导出文件含个人偏好，应保存在仓库外的私有位置。

```sh
node --env-file=.env.production.local --experimental-transform-types scripts/import-sites.mts /private/path/snapshot.json
```

导入使用事务与 ON CONFLICT DO NOTHING，可重放而不覆盖新数据；发现多个源用户时中止，要求明确身份映射。

## 内容与邮件边界

采集不限 AI：数字工具、实体商品、消费品、行业解决方案和设计均可入选。Star 仅为关注度快照；商业判断标为推断，保留原始来源及实际发布日期。历史简报不允许被后续内容覆盖。

邮箱和时间偏好已保留。**邮件服务与实际投递尚未接通**，开关保持关闭，不能将保存邮箱描述为已发送。

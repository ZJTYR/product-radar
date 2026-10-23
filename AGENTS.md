# 拾光产品情报工作台

- 使用中文沟通和维护项目说明。正式仓库为个人私有仓库 `ZJTYR/product-radar`，不得移动到组织或公开仓库。
- 根目录为 Vercel 应用，采用 Next.js、Neon Postgres。`collector-site/` 保存 Sites 云采集服务的源码副本，独立构建。依赖以锁文件为准；Next.js 的当前说明位于 `node_modules/next/dist/docs/`。
- 用户已授权本项目持续更新、同步 GitHub 和发布 Vercel。功能改动完成后必须核验实际 GitHub 身份为 `ZJTYR`，运行 `npm run check`、`npm run lint`，推送功能分支，通过 CI 后按正常 PR 合并到 `main`，等待并验证对应 Vercel 生产部署。不得用本地修改代替交付，不强制推送或绕过仓库门禁。
- Vercel 固定地址为 `https://product-radar-gules.vercel.app/`。所有域名必须保持 Vercel Authentication 的 `All Deployments` 保护；部署前后重新核验。应用只服务个人所有者，不提供多人身份隔离；不得关闭保护或向第三方授予访问。
- `RADAR_OWNER_PRIVATE=true` 只表明已配置平台保护，不是独立的鉴权机制。任何未来公开访问需求都必须先增加真正的应用登录和逐用户授权。
- `.env*`、`.vercel/`、`.local/`、数据库导出、服务凭证、个人收藏及偏好不得进入 Git。只有无真实值的 `.env.example` 可提交。
- 每日采集仍由既有 Sites 云任务执行。它写入原站，再通过持久化待发送队列同步 `/api/catalog` 和 `/api/ingest` 到 Vercel。不要创建重复任务；写入后核对 `/api/sync` 的 `pending=0`，失败如实汇报。
- 修改云采集服务时先用 Sites source helper 打开原项目，同步 `collector-site/` 的改动并按 Sites 技能发布，随后更新本仓库副本。不得拿 Vercel 构建替代 Sites 构建。
- 保留跨行业产品范围、商业分析的推断标识、原始来源和实际发布日期。不得伪造当日内容、销量、图片或邮件发送状态。
- 前端使用正常 HTTP 开发或预览服务验收桌面、手机、收藏保存与控制台。优先使用应用内浏览器；不可用时明确记录检查限制，不能声称已完成该项验收。

import type { IntelItem } from './types';

// 2026-10-22 核验的首期内容；产品观察与发布事件分别标注。
export const seedItems: IntelItem[] = [
  {
    "id": "dify",
    "kind": "product",
    "name": "Dify",
    "title": "把 AI 能力做成业务可用的工作流",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "从模型调用走向完整应用：可视化编排、知识库与发布入口，让团队更快验证 AI 业务场景。",
    "category": "AI 应用",
    "tags": [
      "AI 工作流",
      "知识库",
      "企业软件"
    ],
    "image": "/images/dify-product.webp",
    "accent": "#6c62f3",
    "website": "https://dify.ai",
    "github": "https://github.com/langgenius/dify",
    "repo": "langgenius/dify",
    "stars": 159210,
    "starsCheckedAt": "2026-10-22T07:50:56.942372+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": true,
    "readMinutes": 5,
    "facts": [
      "官方提供 Workflow Studio、Knowledge Pipeline 与工具市场。",
      "支持 Dify Cloud、企业私有部署和社区自托管。",
      "云端提供免费试用层与付费方案。"
    ],
    "audience": "需要把 AI 接入业务流程的产品、运营及开发团队。",
    "pain": "单次聊天难以复用，知识、工具和步骤分散，原型难交接。",
    "workflow": "选择模型与知识源 → 编排处理节点 → 调试样本 → 发布应用 → 查看运行表现。",
    "businessModel": "事实：社区版可自托管，云服务按套餐与资源配额收费，企业部署另行洽谈。判断：从个人试验转向团队生产，是治理与稳定性产生付费意愿的节点。",
    "differentiation": "观察：把知识准备、编排与运行放进同一工作区，降低跨工具拼接成本；不等于无需开发或评估。",
    "opportunity": "推断：先围绕营销内容审核或知识问答做单场景模板，用完成率和人工校对时间验证价值。",
    "designNotes": [
      "官方工作流图采用可缩放画布、节点分组和右上角发布入口。",
      "借鉴：让复杂流程可视化，同时保留单节点检查与整体发布两个层级。"
    ],
    "caveats": [
      "模型、检索与工具调用效果需要实测；自托管不等于免运维。",
      "二次商业化需核对 Dify 许可证附加条件。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://dify.ai"
      },
      {
        "label": "官方定价与版本",
        "url": "https://dify.ai/pricing/dify-cloud"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/langgenius/dify"
      },
      {
        "label": "官方配图来源",
        "url": "https://dify.ai/_astro/workflow.Dl7EY_X1_Z2gyCTA.webp"
      }
    ]
  },
  {
    "id": "n8n",
    "kind": "product",
    "name": "n8n",
    "title": "从连接工具，到交付一条完整业务流程",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "把触发、数据处理、AI 节点和人工审批串起来，适合研究自动化产品如何按业务价值收费。",
    "category": "自动化",
    "tags": [
      "工作流",
      "集成",
      "商业模式"
    ],
    "image": "/images/n8n-product.png",
    "accent": "#ef7d80",
    "website": "https://n8n.io",
    "github": "https://github.com/n8n-io/n8n",
    "repo": "n8n-io/n8n",
    "stars": 208281,
    "starsCheckedAt": "2026-10-22T07:50:58.531821+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": false,
    "readMinutes": 3,
    "facts": [
      "官方定价以每月工作流执行次数为核心计费单位。",
      "提供 Cloud 托管和社区自托管版本。",
      "官网列有 AI 节点、执行记录与人工审批能力。"
    ],
    "audience": "有跨系统重复操作的运营、产品与技术团队。",
    "pain": "数据在表格、消息与业务系统之间反复搬运，异常难追踪。",
    "workflow": "设置触发器 → 连接服务 → 转换数据与调用 AI → 测试 → 定时运行与追踪。",
    "businessModel": "事实：云套餐按执行量分层；企业能力包含治理、环境和支持等差异。判断：围绕“完成一次业务流程”计价，更容易与节省的人时建立对应。",
    "differentiation": "观察：节点编排与可写代码并存，覆盖从简单连接到复杂处理的连续需求。",
    "opportunity": "推断：可将“资讯采集→去重→简报→邮件”封装为可配置模板，先用失败率与节省时间衡量价值。",
    "designNotes": [
      "官方 README 配图展示节点、连接关系与流程分支。",
      "借鉴：运行状态与错误定位应直接回到流程节点，避免只报一句失败。"
    ],
    "caveats": [
      "采用 Sustainable Use License 等许可，不能把“代码公开”直接理解为无限制转售。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://n8n.io"
      },
      {
        "label": "官方定价与版本",
        "url": "https://n8n.io/pricing/"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/n8n-io/n8n"
      },
      {
        "label": "官方配图来源",
        "url": "https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-screenshot-readme.png"
      }
    ]
  },
  {
    "id": "affine",
    "kind": "product",
    "name": "AFFiNE",
    "title": "文档和白板，为什么要放进同一工作区",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "从线性写作切换到空间思考，研究知识工作产品如何减少工具切换并设计增值边界。",
    "category": "知识协作",
    "tags": [
      "文档",
      "白板",
      "本地优先"
    ],
    "image": "/images/affine-product.png",
    "accent": "#8b77e8",
    "website": "https://affine.pro",
    "github": "https://github.com/toeverything/AFFiNE",
    "repo": "toeverything/AFFiNE",
    "stars": 73745,
    "starsCheckedAt": "2026-10-22T07:50:58.040210+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": false,
    "readMinutes": 3,
    "facts": [
      "官网提供 Docs、Edgeless 与 AI 等产品能力。",
      "定价页描述本地优先设计、团队空间与企业部署选项。",
      "AI 作为增值能力单独呈现。"
    ],
    "audience": "需要整理研究、讨论方案并沉淀团队知识的知识工作者。",
    "pain": "文档适合结构化表达，白板适合发散，同一资料在两者之间重复整理。",
    "workflow": "记录内容 → 在文档与空间画布组织想法 → 团队协作 → 使用 AI 整理。",
    "businessModel": "事实：提供个人、团队与 AI 增值方案，企业部署需咨询。判断：协作规模和 AI 使用带来的持续价值，是比单纯编辑功能更清晰的付费理由。",
    "differentiation": "观察：文档与画布共用工作空间，比只堆叠编辑工具更强调思考过程。",
    "opportunity": "推断：把需求调研原始材料、关系梳理和结论放在同一项目空间，验证是否减少二次整理。",
    "designNotes": [
      "当前配图是官方 README 品牌概览，用于品牌视觉参考，不是现场运行截图。",
      "借鉴：将写作、画图、规划作为任务入口，用户更容易理解组合能力。"
    ],
    "caveats": [
      "不同组件许可证不同，编辑器与后端许可不能混用。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://affine.pro"
      },
      {
        "label": "官方定价与版本",
        "url": "https://affine.pro/pricing"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/toeverything/AFFiNE"
      },
      {
        "label": "官方配图来源",
        "url": "https://cdn.affine.pro/Github_hero_image2.png"
      }
    ]
  },
  {
    "id": "appflowy",
    "kind": "product",
    "name": "AppFlowy",
    "title": "把文档、任务和团队知识连成工作空间",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "从个人免费进入团队协作，研究模块化工作空间的使用扩展与收费路径。",
    "category": "知识协作",
    "tags": [
      "工作空间",
      "项目管理",
      "AI 搜索"
    ],
    "image": "/images/appflowy.png",
    "accent": "#9361df",
    "website": "https://appflowy.com",
    "github": "https://github.com/AppFlowy-IO/AppFlowy",
    "repo": "AppFlowy-IO/AppFlowy",
    "stars": 77639,
    "starsCheckedAt": "2026-10-22T07:50:59.688803+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": false,
    "readMinutes": 3,
    "facts": [
      "官网列有文档、数据库、任务与 AI 能力。",
      "定价页区分个人与按成员收费的 Pro。",
      "提供云端与自托管选项。"
    ],
    "audience": "从个人知识整理逐步扩展到团队项目协作的用户。",
    "pain": "任务与背景文档分离，交接靠复制链接，信息很快失去上下文。",
    "workflow": "创建团队空间 → 组织页面和任务视图 → 邀请成员 → 搜索与复用。",
    "businessModel": "事实：个人层免费，Pro 按成员订阅并提供更高资源与协作能力。判断：多人共用知识与流程后，切换成本和治理需求会提高付费意愿。",
    "differentiation": "观察：页面、数据库和任务放在一个产品心智内，利于从轻量使用扩展。",
    "opportunity": "推断：可参考其个人到团队路径，为产品资料库增加共享精选集合，再验证团队是否持续使用。",
    "designNotes": [
      "配图为官网宣传图，包含真实产品界面示意。",
      "借鉴：左侧团队结构保持稳定，内容区通过视图标签切换任务表达。"
    ],
    "caveats": [
      "宣传图不代表所有版本能力一致；AI 质量与自托管资源需要单独验证。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://appflowy.com"
      },
      {
        "label": "官方定价与版本",
        "url": "https://appflowy.com/pricing"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/AppFlowy-IO/AppFlowy"
      },
      {
        "label": "官方配图来源",
        "url": "https://appflowy.com/_next/static/media/og-image.838814e7.png"
      }
    ]
  },
  {
    "id": "twenty",
    "kind": "product",
    "name": "Twenty",
    "title": "CRM 的价值，来自适配业务对象",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "从客户表格到可配置业务系统：研究易用界面、可扩展数据模型与企业治理的组合。",
    "category": "客户管理",
    "tags": [
      "CRM",
      "可配置",
      "B2B SaaS"
    ],
    "image": "/images/twenty-product.webp",
    "accent": "#535c71",
    "website": "https://twenty.com",
    "github": "https://github.com/twentyhq/twenty",
    "repo": "twentyhq/twenty",
    "stars": 59410,
    "starsCheckedAt": "2026-10-22T07:50:57.791767+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": false,
    "readMinutes": 3,
    "facts": [
      "官方提供自定义对象、字段与多种视图。",
      "定价区分 Pro、Organization 与 Enterprise。",
      "更高套餐包含行级权限、SSO 或隔离等企业能力。"
    ],
    "audience": "需要管理客户关系与自定义业务数据的销售和运营团队。",
    "pain": "表格缺乏关系和权限，传统 CRM 的定制成本又太高。",
    "workflow": "导入客户 → 配置对象和字段 → 设置视图 → 跟进互动 → 汇总业务进展。",
    "businessModel": "事实：按用户订阅，并有企业方案。判断：从通用记录进入权限、身份与规模治理，形成明确的企业付费升级路径。",
    "differentiation": "观察：以熟悉的表格界面承载可扩展数据模型，降低定制系统的使用门槛。",
    "opportunity": "推断：可借鉴“主记录＋自定义视图”，避免产品资讯在多个栏目重复维护。",
    "designNotes": [
      "官方 README 配图展示 CRM 产品能力。",
      "借鉴：窄侧栏、表格与属性面板分工明确，适合高频数据操作。"
    ],
    "caveats": [
      "开放代码不等于企业治理能力全部免费；客户收益与留存未独立核验。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://twenty.com"
      },
      {
        "label": "官方定价与版本",
        "url": "https://twenty.com/pricing"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/twentyhq/twenty"
      },
      {
        "label": "官方配图来源",
        "url": "https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-website/public/images/readme/v2-crm-tools-light.webp"
      }
    ]
  },
  {
    "id": "plane",
    "kind": "product",
    "name": "Plane",
    "title": "让反馈、任务与文档进入同一条交付路径",
    "subtitle": "高关注产品观察 · 商业与产品拆解",
    "summary": "观察项目管理产品如何在轻量启动与团队治理之间分层，减少功能过载。",
    "category": "项目协作",
    "tags": [
      "项目管理",
      "看板",
      "团队协作"
    ],
    "image": "/images/plane-product.webp",
    "accent": "#4c82dd",
    "website": "https://plane.so",
    "github": "https://github.com/makeplane/plane",
    "repo": "makeplane/plane",
    "stars": 61269,
    "starsCheckedAt": "2026-10-22T07:50:59.158908+00:00",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "featured": false,
    "readMinutes": 3,
    "facts": [
      "官方提供工作项、周期、模块、视图和项目文档。",
      "提供 Cloud 和 Self-hosted 两种路径。",
      "套餐按席位分层，团队治理和扩展能力随套餐增加。"
    ],
    "audience": "希望统一需求、研发计划与团队跟进的产品和工程团队。",
    "pain": "反馈进入后难分流，任务状态和背景文档散落不同位置。",
    "workflow": "收集反馈 → 整理工作项 → 编入周期或模块 → 执行跟进 → 复盘交付。",
    "businessModel": "事实：有免费层、按席位付费层与企业定制。判断：基础任务功能促成启动，跨团队流程与治理需求推动升级。",
    "differentiation": "观察：工作项与文档共处项目上下文，强调从反馈到执行的连续性。",
    "opportunity": "推断：借鉴紧凑列表与统一详情，先让团队快速找到任务，再逐步展开高级配置。",
    "designNotes": [
      "官方 README 图为工作项界面展示。",
      "借鉴：状态、优先级与负责人紧贴任务，更多细节进入统一详情区。"
    ],
    "caveats": [
      "社区版与商业版功能边界需按版本核对。",
      "Star 是关注信号，不代表付费用户或商业成功。",
      "本条是产品观察，不表示今日发布；套餐以官方页面为准。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://plane.so"
      },
      {
        "label": "官方定价与版本",
        "url": "https://plane.so/pricing"
      },
      {
        "label": "GitHub 仓库",
        "url": "https://github.com/makeplane/plane"
      },
      {
        "label": "官方配图来源",
        "url": "https://media.docs.plane.so/GitHub-readme/github-work-items.webp"
      }
    ]
  },
  {
    "id": "linear",
    "kind": "design",
    "name": "Linear",
    "title": "克制的深色界面，也能把复杂计划讲清楚",
    "subtitle": "真实产品灵感 · 官方界面展示",
    "summary": "时间线、层级和细线条共同建立秩序，适合借鉴到项目工作台与路线图。",
    "category": "设计灵感",
    "tags": [
      "深色",
      "时间线",
      "极简"
    ],
    "image": "/images/linear-product.png",
    "accent": "#7068f3",
    "website": "https://linear.app",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "readMinutes": 3,
    "facts": [
      "官网定位为产品开发系统，涵盖规划与执行。",
      "官方展示项目、工作项与时间线等界面。"
    ],
    "audience": "高频处理计划、需求与交付状态的产品团队。",
    "pain": "界面信息多时，装饰与操作竞争注意力。",
    "workflow": "查看计划 → 定位项目 → 查看工作项与上下文 → 更新进展。",
    "businessModel": "事实：有免费层、按用户收费的 Basic、Business 和企业方案。判断：高频协作与组织治理使持续订阅更容易成立。",
    "differentiation": "观察：通过低饱和背景、细边界与有限强调色维持信息密度。",
    "opportunity": "推断：可把今日精选与收藏工作台的状态色收敛，让内容与主要行动更突出。",
    "designNotes": [
      "官方时间线图用连续日期刻度建立定位，里程碑采用少量高亮。",
      "细分隔线和暗背景让内容形成层次，不必为每个区块增加重阴影。",
      "适合：项目计划、路线图；需验证移动端可读性与文字对比度。"
    ],
    "caveats": [
      "配图来自官方产品展示素材；动效与实际操作需访问官网体验。",
      "设计判断是编辑观察，不是转化率或可用性测试结论。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://linear.app"
      },
      {
        "label": "官方定价",
        "url": "https://linear.app/pricing"
      },
      {
        "label": "官方界面配图",
        "url": "https://linear.app/cdn-cgi/imagedelivery/fO02fVwohEs9s9UHFwon6A/7d7115d9-a0eb-4a92-5900-3ca3ee077d00/f=auto,fit=scale-down,metadata=none"
      }
    ]
  },
  {
    "id": "raycast",
    "kind": "design",
    "name": "Raycast",
    "title": "一个搜索入口，承接多种操作",
    "subtitle": "真实产品灵感 · 官方界面展示",
    "summary": "从统一输入到可执行结果，研究命令入口怎样减少导航成本，同时保持品牌识别。",
    "category": "设计灵感",
    "tags": [
      "深色",
      "命令入口",
      "键盘优先"
    ],
    "image": "/images/raycast-product.png",
    "accent": "#e36366",
    "website": "https://www.raycast.com",
    "publishedAt": null,
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "产品观察",
    "readMinutes": 3,
    "facts": [
      "官网将 Raycast 定位为可扩展效率启动器。",
      "官方介绍扩展、搜索和 AI 等功能。"
    ],
    "audience": "频繁切换应用、查资料与执行快捷操作的桌面用户。",
    "pain": "每个工具都有独立导航，找功能比执行动作更费力。",
    "workflow": "唤起入口 → 输入意图 → 预览结果 → 执行动作。",
    "businessModel": "事实：个人基础能力免费；付费方案包含 AI 与进阶能力，团队按用户付费。判断：高频入口积累习惯，增值能力承接深度用户。",
    "differentiation": "观察：黑色界面、红色品牌背景和清晰的结果焦点形成辨识度。",
    "opportunity": "推断：资讯工作台可以把搜索扩展为“找产品、找风格、找收藏”的统一入口，先观察使用频率。",
    "designNotes": [
      "官方搜索展示采用高对比选中框，突出当前焦点。",
      "结果先给内容预览，再提供动作，适合减少反复打开页面。",
      "适合：全局搜索、快捷操作；手机端需要显式按钮补充键盘路径。"
    ],
    "caveats": [
      "配图来自官方产品展示素材；动效与实际操作需访问官网体验。",
      "设计判断是编辑观察，不是转化率或可用性测试结论。"
    ],
    "sources": [
      {
        "label": "官方产品网站",
        "url": "https://www.raycast.com"
      },
      {
        "label": "官方定价",
        "url": "https://www.raycast.com/pricing"
      },
      {
        "label": "官方界面配图",
        "url": "https://www.raycast.com/_next/static/immutable/media/screenshot-search.0p3ub7wrqbi86.png"
      }
    ]
  },
  {
    "id": "openai-cache-12h",
    "kind": "ai",
    "name": "OpenAI",
    "title": "12 小时提示缓存，让重复上下文更值得经营",
    "subtitle": "官方更新 · 2026.10.20",
    "summary": "每天多批次使用同一套指令和资料的 AI 工作流，可以重新核算缓存策略与单次任务成本。",
    "category": "AI 动态",
    "tags": [
      "成本优化",
      "提示缓存",
      "API"
    ],
    "accent": "#347d68",
    "website": "https://developers.openai.com/api/docs/changelog",
    "publishedAt": "2026-10-20",
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "官方发布",
    "readMinutes": 2,
    "facts": [
      "10 月 20 日官方更新日志宣布 API 可选择 12 小时提示缓存。",
      "官方说明缓存写入按输入价格的 2.5 倍计费。"
    ],
    "audience": "维护重复上下文工作流的 AI 产品团队。",
    "pain": "共用指令和长资料多次输入，难以判断缓存能否抵消写入成本。",
    "workflow": "统计重复前缀 → 测算调用间隔 → 比较写入与命中成本 → 小范围实测。",
    "businessModel": "事实：属于 API 用量计费能力。判断：对重复任务密集的产品可能改善单位成本，低频场景未必获益。",
    "differentiation": "把缓存保持时间延长到跨小时任务间隔，实际收益取决于命中与调用结构。",
    "opportunity": "推断：对资讯筛选、固定分类和简报生成分别记录成本，决定哪些任务复用相同前缀。",
    "designNotes": [
      "产品启发：在运行详情展示本次用量与缓存命中，帮助使用者理解成本。"
    ],
    "caveats": [
      "收益推断未经本工作台实测。",
      "模型支持、数据设置和价格以官方文档为准。"
    ],
    "sources": [
      {
        "label": "官方更新日志 · 10 月 20 日",
        "url": "https://developers.openai.com/api/docs/changelog"
      },
      {
        "label": "提示缓存说明",
        "url": "https://developers.openai.com/api/docs/guides/prompt-caching"
      }
    ]
  },
  {
    "id": "claude-haiku-55",
    "kind": "ai",
    "name": "Anthropic",
    "title": "Haiku 5.5：把高频小任务放回产品成本模型",
    "subtitle": "官方发布 · 2026.10.07",
    "summary": "官方面向摘要、分类和子任务推出小模型更新；产品重点是重新验证任务分工与响应体验。",
    "category": "AI 动态",
    "tags": [
      "小模型",
      "任务分工",
      "AI 应用"
    ],
    "accent": "#c17b5b",
    "website": "https://www.anthropic.com/claude-haiku-5-5",
    "publishedAt": "2026-10-07",
    "discoveredAt": "2026-10-22T07:56:40.274345+00:00",
    "evidence": "官方发布",
    "readMinutes": 2,
    "facts": [
      "官方新闻列表标注 2026 年 10 月 7 日发布 Haiku 5.5。",
      "官方定位覆盖摘要、分类、查询及高频任务，并提供可调推理强度。",
      "性能和成本改善为厂商自述，未在本工作台独立复现。"
    ],
    "audience": "处理大量摘要、分类和客服任务的 AI 产品团队。",
    "pain": "每种任务都调用同一档模型，可能把预算花在不必要的复杂推理上。",
    "workflow": "建立真实样本集 → 对比质量和响应 → 将简单任务分配小模型 → 失败转人工或更强模型。",
    "businessModel": "事实：Claude Platform 按 token 等用量收费。判断：低单位成本可支持更多后台任务，但需要计入重试和校验成本。",
    "differentiation": "厂商强调速度、成本与高频工作定位；不把基准分数直接当作业务效果。",
    "opportunity": "推断：资讯分类可先用小模型，商业深拆再用更强模型；以人工认可率验证分工。",
    "designNotes": [
      "产品启发：让用户看到处理结果和需确认项，避免暴露复杂模型选择。"
    ],
    "caveats": [
      "这是 10 月 7 日的近期发布补录，不是今日新发布。",
      "厂商测试不代表你的数据与任务表现，需另做小样本验证。"
    ],
    "sources": [
      {
        "label": "官方发布页",
        "url": "https://www.anthropic.com/claude-haiku-5-5"
      },
      {
        "label": "官方新闻与发布日期",
        "url": "https://www.anthropic.com/news"
      }
    ]
  }
];

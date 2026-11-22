/**
 * 演示组织的数据定义（虚构企业「示例科技」）：人物、产品结构、项目、需求、Bug、发版、文档。
 * 日期一律写成「相对今天的天数」，生成时换算，所以每次重置后进度看起来都是新的。
 * 只放数据，不碰数据库；生成逻辑在 ./service.ts。
 */

export type PersonaKey = "zhou" | "chen" | "lin" | "wang" | "zhao" | "sun" | "wu" | "zheng" | "he" | "feng" | "xu";
export type Persona = { key: PersonaKey; name: string; position: string; role: "manager" | "member"; dept: "product" | "rd" | "qa" | "biz" };

export const DEMO_ORG_NAME = "示例科技";
export const DEMO_ORG_CODE = "demo";
export const DEMO_EMAIL_DOMAIN = "demo.weavi.invalid";

export const DEPARTMENTS: { key: Persona["dept"]; name: string }[] = [
  { key: "product", name: "产品部" },
  { key: "rd", name: "研发部" },
  { key: "qa", name: "质量部" },
  { key: "biz", name: "业务运营部" },
];

export const PERSONAS: Persona[] = [
  { key: "zhou", name: "周敏", position: "pm", role: "manager", dept: "product" },
  { key: "chen", name: "陈晨", position: "product", role: "member", dept: "product" },
  { key: "lin", name: "林悦", position: "product", role: "member", dept: "product" },
  { key: "wang", name: "王磊", position: "pm", role: "member", dept: "rd" },
  { key: "zhao", name: "赵航", position: "tech_lead", role: "member", dept: "rd" },
  { key: "sun", name: "孙婷", position: "frontend", role: "member", dept: "rd" },
  { key: "wu", name: "吴涛", position: "frontend", role: "member", dept: "rd" },
  { key: "zheng", name: "郑凯", position: "backend", role: "member", dept: "rd" },
  { key: "he", name: "何静", position: "backend", role: "member", dept: "rd" },
  { key: "feng", name: "冯雪", position: "qa", role: "member", dept: "qa" },
  { key: "xu", name: "许诺", position: "business", role: "member", dept: "biz" },
];

/** 产品功能结构：菜单 › 功能模块 › 功能点 */
export type NodeDef = { name: string; children?: NodeDef[] };
export type ProductDef = {
  key: string;
  name: string;
  code: string;
  owner: PersonaKey;
  status: "planning" | "maintaining";
  description: string;
  intro: string;
  envs: { name: string; urls: { label: string; url: string; network: "external" | "internal"; note: string }[] }[];
  tree: NodeDef[];
};

export const PRODUCTS: ProductDef[] = [
  {
    key: "mall",
    name: "小围商城",
    code: "DEMO-MALL",
    owner: "chen",
    status: "maintaining",
    description: "面向消费者的线上商城：商品、下单结算、售后与会员积分。",
    intro: [
      "> **一句话介绍**",
      ">",
      "> 小围商城是示例科技的自营电商平台，覆盖 Web、H5 和小程序三端，服务约 120 万注册会员。",
      "",
      "## 产品定位",
      "",
      "| 维度 | 说明 |",
      "| --- | --- |",
      "| 目标用户 | 25–40 岁、注重品质的城市家庭用户 |",
      "| 核心场景 | 日常补货、节日大促、会员积分兑换 |",
      "| 关键指标 | 下单转化率、客单价、30 日复购率 |",
      "",
      "## 业务流程",
      "",
      "```mermaid",
      "flowchart LR",
      '  A["浏览商品"] --> B["加入购物车"]',
      '  B --> C["结算下单"]',
      '  C -->|"支付成功"| D["仓库发货"]',
      '  C -->|"超时未付"| E["自动取消"]',
      '  D --> F["确认收货"]',
      '  F -->|"7 天内"| G["申请售后"]',
      "```",
      "",
      "## 版本节奏",
      "",
      "每两周发一个常规版本，周四晚上线；线上问题走紧急发版，当天修复当天上线。",
    ].join("\n"),
    envs: [
      { name: "生产", urls: [{ label: "商城首页", url: "https://mall.example.com", network: "external", note: "演示地址，不可访问" }] },
      { name: "测试", urls: [{ label: "测试环境", url: "https://mall-test.example.com", network: "internal", note: "每天 02:00 同步脱敏数据" }] },
    ],
    tree: [
      { name: "首页", children: [{ name: "首页装修", children: [{ name: "轮播配置" }, { name: "楼层组件" }] }] },
      {
        name: "商品",
        children: [
          { name: "商品详情", children: [{ name: "规格选择" }, { name: "详情页视频" }] },
          { name: "商品搜索", children: [{ name: "搜索联想" }, { name: "筛选排序" }] },
        ],
      },
      {
        name: "订单",
        children: [
          { name: "下单结算", children: [{ name: "优惠券叠加" }, { name: "发票信息" }, { name: "地址识别" }] },
          { name: "售后", children: [{ name: "退货申请" }] },
          { name: "订单列表", children: [{ name: "列表性能" }] },
        ],
      },
      {
        name: "会员",
        children: [
          { name: "积分", children: [{ name: "积分抵扣" }, { name: "积分商城" }, { name: "积分规则" }] },
          { name: "会员等级", children: [{ name: "等级权益" }] },
        ],
      },
      { name: "营销", children: [{ name: "大促会场", children: [{ name: "倒计时组件" }, { name: "分享海报" }] }] },
    ],
  },
  {
    key: "store",
    name: "门店助手",
    code: "DEMO-STORE",
    owner: "lin",
    status: "maintaining",
    description: "给线下门店店员用的 App：收银、库存盘点、交班对账和门店报表。",
    intro: [
      "> **一句话介绍**",
      ">",
      "> 门店助手是示例科技 86 家线下门店的店员 App（iOS / Android / 收银一体机）。",
      "",
      "## 使用角色",
      "",
      "| 角色 | 主要功能 |",
      "| --- | --- |",
      "| 收银员 | 扫码收银、退款、交班对账 |",
      "| 店长 | 盘点审核、库存预警、门店日报 |",
      "| 区域经理 | 多门店报表、排班 |",
      "",
      "## 盘点流程",
      "",
      "```mermaid",
      "stateDiagram-v2",
      '  [*] --> 待盘点',
      '  待盘点 --> 盘点中: 店员开始扫码',
      '  盘点中 --> 待审核: 提交',
      '  待审核 --> 已完成: 店长确认',
      '  待审核 --> 盘点中: 差异过大退回',
      '  已完成 --> [*]',
      "```",
    ].join("\n"),
    envs: [
      { name: "生产", urls: [{ label: "管理后台", url: "https://store-admin.example.com", network: "external", note: "演示地址，不可访问" }] },
      { name: "预发", urls: [{ label: "预发后台", url: "https://store-pre.example.com", network: "internal", note: "" }] },
    ],
    tree: [
      { name: "工作台", children: [{ name: "今日待办", children: [{ name: "消息提醒" }] }] },
      { name: "库存", children: [{ name: "盘点", children: [{ name: "扫码盘点" }, { name: "差异审核" }] }, { name: "库存预警", children: [{ name: "预警阈值" }] }] },
      { name: "收银", children: [{ name: "收银台", children: [{ name: "扫码支付" }, { name: "交班对账" }, { name: "小票模板" }] }] },
      { name: "数据", children: [{ name: "门店报表", children: [{ name: "销售日报" }] }] },
      { name: "人员", children: [{ name: "排班", children: [{ name: "员工排班" }] }] },
    ],
  },
];

export type ProjectDef = {
  key: string;
  projectKey: string;
  name: string;
  product: string;
  description: string;
  endIn: number;
  members: PersonaKey[];
};

export const PROJECTS: ProjectDef[] = [
  { key: "mall", projectKey: "DEMO-MALL2", name: "商城 2.0 改版", product: "mall", description: "首页装修、商品详情和结算链路改版，配合双 11 大促。", endIn: 45, members: ["zhou", "chen", "wang", "zhao", "sun", "wu", "zheng", "he", "feng", "xu"] },
  { key: "store", projectKey: "DEMO-STORE15", name: "门店助手 1.5", product: "store", description: "离线盘点、聚合支付和交班对账，覆盖全部 86 家门店。", endIn: 30, members: ["zhou", "lin", "wang", "zhao", "wu", "he", "feng", "xu"] },
  { key: "points", projectKey: "DEMO-POINTS", name: "会员积分体系", product: "mall", description: "积分获取、抵扣、兑换和等级权益，提升会员复购。", endIn: 60, members: ["zhou", "chen", "lin", "zhao", "sun", "zheng", "feng"] },
];

/** 需求：负责人按槽位（product / frontend / backend / qa） */
export type ReqDef = {
  ref: string;
  project: string | null;
  product: string;
  node: string;
  title: string;
  status: string;
  priority: string;
  start: number;
  end: number;
  doneAt?: number;
  proposer: PersonaKey;
  people: Partial<Record<"product" | "frontend" | "backend" | "qa", PersonaKey>>;
  tags?: string[];
  summary: string;
  parent?: string;
};

export const REQUIREMENTS: ReqDef[] = [
  // 商城 2.0 改版
  { ref: "m-promo", project: "mall", product: "mall", node: "大促会场", title: "双 11 大促会场", status: "req_done", priority: "p0", start: -12, end: 20, proposer: "xu", people: { product: "chen" }, tags: ["大促"], summary: "11 月大促的主会场：倒计时、分会场入口、分享海报，大促前一周上线。" },
  { ref: "m-countdown", parent: "m-promo", project: "mall", product: "mall", node: "倒计时组件", title: "大促倒计时组件", status: "dev_in_progress", priority: "p1", start: -6, end: 5, proposer: "chen", people: { product: "chen", frontend: "sun", qa: "feng" }, tags: ["大促"], summary: "会场顶部倒计时，精确到秒，服务端校时，结束后自动切换为「活动已结束」。" },
  { ref: "m-poster", parent: "m-promo", project: "mall", product: "mall", node: "分享海报", title: "会场分享海报", status: "dev_todo", priority: "p2", start: 2, end: 12, proposer: "xu", people: { product: "chen", frontend: "wu", backend: "he", qa: "feng" }, tags: ["大促"], summary: "用户一键生成带二维码的分享海报，扫码进入会场时记录邀请人。" },
  { ref: "m-floor", project: "mall", product: "mall", node: "楼层组件", title: "首页楼层组件可视化配置", status: "dev_in_progress", priority: "p1", start: -10, end: 6, proposer: "xu", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, tags: ["运营提效"], summary: "运营在后台拖拽配置首页楼层（商品、图片、优惠券），预览后发布，不再需要发版。" },
  { ref: "m-banner", project: "mall", product: "mall", node: "轮播配置", title: "轮播图按人群投放", status: "req_design", priority: "p2", start: 0, end: 18, proposer: "xu", people: { product: "chen", frontend: "wu", backend: "zheng" }, summary: "轮播图可以按新客、老客、会员等级投放不同内容。" },
  { ref: "m-video", project: "mall", product: "mall", node: "详情页视频", title: "商品详情页支持短视频", status: "test_in_progress", priority: "p1", start: -18, end: 2, proposer: "chen", people: { product: "chen", frontend: "wu", backend: "he", qa: "feng" }, summary: "详情页首图位置支持 60 秒内短视频，Wi-Fi 下自动静音播放。" },
  { ref: "m-spec", project: "mall", product: "mall", node: "规格选择", title: "规格选择改为图片规格", status: "online", priority: "p2", start: -35, end: -16, doneAt: -14, proposer: "chen", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, summary: "颜色等规格用缩略图展示，选中后切换主图。" },
  { ref: "m-suggest", project: "mall", product: "mall", node: "搜索联想", title: "搜索联想词与纠错", status: "dev_todo", priority: "p1", start: 1, end: 14, proposer: "chen", people: { product: "chen", frontend: "wu", backend: "he", qa: "feng" }, summary: "输入时给出联想词，拼写或拼音错误时自动纠正并提示「已为你搜索」。" },
  { ref: "m-filter", project: "mall", product: "mall", node: "筛选排序", title: "搜索结果筛选排序重构", status: "dev_done", priority: "p2", start: -14, end: 0, proposer: "chen", people: { product: "chen", frontend: "sun", backend: "he", qa: "feng" }, summary: "筛选项按类目动态下发，排序支持销量、价格、新品，筛选结果数实时显示。" },
  { ref: "m-coupon", project: "mall", product: "mall", node: "优惠券叠加", title: "优惠券与满减叠加计算", status: "test_todo", priority: "p0", start: -16, end: 3, proposer: "xu", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, tags: ["大促", "资损风险"], summary: "店铺券、平台券和满减按固定顺序叠加，结算页展示每一项优惠明细。" },
  { ref: "m-invoice", project: "mall", product: "mall", node: "发票信息", title: "电子发票开具", status: "req_in_progress", priority: "p2", start: 5, end: 28, proposer: "xu", people: { product: "chen" }, summary: "下单时填写抬头，签收后自动开具电子发票并发送到邮箱。" },
  { ref: "m-return", project: "mall", product: "mall", node: "退货申请", title: "退货申请上传凭证", status: "online", priority: "p1", start: -40, end: -18, doneAt: -14, proposer: "xu", people: { product: "chen", frontend: "wu", backend: "he", qa: "feng" }, summary: "退货时可上传最多 6 张图片或 1 段视频作为凭证。" },
  { ref: "m-orders", project: "mall", product: "mall", node: "列表性能", title: "订单列表性能优化", status: "online", priority: "p2", start: -30, end: -15, doneAt: -14, proposer: "zhao", people: { frontend: "sun", backend: "zheng", qa: "feng" }, tags: ["性能"], summary: "订单列表首屏从 2.4 秒降到 0.8 秒：分页游标、图片懒加载、接口合并。" },
  { ref: "m-address", project: "mall", product: "mall", node: "地址识别", title: "结算页地址智能识别", status: "test_done", priority: "p2", start: -15, end: -1, proposer: "chen", people: { product: "chen", frontend: "wu", backend: "he", qa: "feng" }, summary: "粘贴一段文字自动拆出收件人、手机号和省市区。" },
  { ref: "m-bundle", project: "mall", product: "mall", node: "优惠券叠加", title: "购物车凑单推荐", status: "cancelled", priority: "p3", start: -20, end: -5, proposer: "xu", people: { product: "chen" }, summary: "评审后决定合并到大促会场一起做，本需求取消。" },
  // 门店助手 1.5
  { ref: "s-offline", project: "store", product: "store", node: "扫码盘点", title: "扫码盘点支持离线", status: "dev_in_progress", priority: "p0", start: -8, end: 8, proposer: "lin", people: { product: "lin", frontend: "wu", backend: "he", qa: "feng" }, tags: ["门店反馈"], summary: "仓库信号差时也能继续扫码，联网后自动上传，冲突时以后提交为准并提示。" },
  { ref: "s-review", project: "store", product: "store", node: "差异审核", title: "盘点差异审核流程", status: "req_done", priority: "p1", start: 3, end: 16, proposer: "xu", people: { product: "lin", backend: "he" }, summary: "差异超过 2% 的盘点单需要店长审核，审核通过后才更新库存。" },
  { ref: "s-pay", project: "store", product: "store", node: "扫码支付", title: "收银台聚合扫码支付", status: "online", priority: "p0", start: -45, end: -22, doneAt: -20, proposer: "xu", people: { product: "lin", frontend: "wu", backend: "he", qa: "feng" }, summary: "一个扫码枪同时支持微信、支付宝和云闪付付款码。" },
  { ref: "s-shift", project: "store", product: "store", node: "交班对账", title: "交班对账单", status: "test_in_progress", priority: "p1", start: -12, end: 1, proposer: "xu", people: { product: "lin", frontend: "wu", backend: "he", qa: "feng" }, summary: "交班时自动汇总现金、扫码和退款金额，与钱箱实点金额对比，差额需要备注。" },
  { ref: "s-notice", project: "store", product: "store", node: "消息提醒", title: "消息提醒分级", status: "dev_done", priority: "p2", start: -10, end: -1, proposer: "lin", people: { product: "lin", frontend: "wu", backend: "he", qa: "feng" }, summary: "缺货、退款审批为紧急提醒（响铃 + 弹窗），其他为普通提醒。" },
  { ref: "s-daily", project: "store", product: "store", node: "销售日报", title: "门店销售日报推送", status: "test_todo", priority: "p2", start: -9, end: 1, proposer: "zhou", people: { product: "lin", backend: "he", qa: "feng" }, summary: "每天 22:00 把当日销售额、客单价、Top10 商品推送给店长。" },
  { ref: "s-alert", project: "store", product: "store", node: "预警阈值", title: "库存预警阈值配置", status: "req_in_progress", priority: "p2", start: 8, end: 25, proposer: "xu", people: { product: "lin" }, summary: "按商品或品类设置最低库存，低于阈值时提醒店长补货。" },
  { ref: "s-roster", project: "store", product: "store", node: "员工排班", title: "员工排班（下个版本）", status: "req_in_progress", priority: "p3", start: 20, end: 50, proposer: "zhou", people: { product: "lin" }, summary: "区域经理按周排班，店员在 App 里查看班表和申请换班。" },
  { ref: "s-receipt", project: "store", product: "store", node: "小票模板", title: "收银小票模板自定义", status: "online", priority: "p3", start: -40, end: -24, doneAt: -20, proposer: "xu", people: { product: "lin", frontend: "wu", backend: "he", qa: "feng" }, summary: "门店可以在小票底部加活动二维码和自定义文案。" },
  { ref: "s-ipad", project: "store", product: "store", node: "收银台", title: "iPad 横屏适配", status: "cancelled", priority: "p3", start: -25, end: -10, proposer: "wu", people: { product: "lin" }, summary: "门店统一换收银一体机后不再需要，取消。" },
  // 会员积分体系
  { ref: "p-deduct", project: "points", product: "mall", node: "积分抵扣", title: "积分抵扣下单", status: "dev_in_progress", priority: "p0", start: -9, end: 7, proposer: "chen", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, tags: ["资损风险"], summary: "结算时用积分抵扣现金，100 积分 = 1 元，单笔最多抵扣订单金额的 20%。" },
  { ref: "p-mall", project: "points", product: "mall", node: "积分商城", title: "积分商城兑换", status: "test_in_progress", priority: "p1", start: -20, end: 0, proposer: "lin", people: { product: "lin", frontend: "sun", backend: "zheng", qa: "feng" }, summary: "积分兑换实物和优惠券，库存实时扣减，兑换后不可退。" },
  { ref: "p-level", project: "points", product: "mall", node: "等级权益", title: "会员等级权益页", status: "online", priority: "p1", start: -30, end: -11, doneAt: -9, proposer: "chen", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, summary: "展示当前等级、升级进度和各等级权益对比。" },
  { ref: "p-expire", project: "points", product: "mall", node: "积分规则", title: "积分过期提醒", status: "req_in_progress", priority: "p2", start: 4, end: 22, proposer: "xu", people: { product: "chen" }, summary: "积分到期前 30 天、7 天各提醒一次（站内信 + 短信）。" },
  { ref: "p-export", project: "points", product: "mall", node: "积分规则", title: "积分流水导出", status: "dev_todo", priority: "p3", start: 6, end: 20, proposer: "xu", people: { product: "lin", backend: "zheng" }, summary: "运营后台按时间段导出积分发放和消耗流水。" },
  { ref: "p-rules", project: "points", product: "mall", node: "积分规则", title: "积分规则配置后台", status: "test_done", priority: "p1", start: -18, end: -2, proposer: "chen", people: { product: "chen", frontend: "sun", backend: "zheng", qa: "feng" }, summary: "运营可配置下单、评价、签到的积分获取规则，修改后次日生效。" },
  // 公共需求池（还没排进项目）
  { ref: "pool-mini", project: null, product: "mall", node: "首页装修", title: "小程序商城首页改版", status: "req_in_progress", priority: "p2", start: 15, end: 45, proposer: "xu", people: {}, summary: "小程序首页和 H5 统一楼层组件，减少重复开发。" },
  { ref: "pool-gift", project: null, product: "mall", node: "下单结算", title: "礼品卡支付", status: "req_in_progress", priority: "p3", start: 30, end: 60, proposer: "xu", people: {}, summary: "企业客户批量采购礼品卡，员工在商城下单时用礼品卡支付。" },
  { ref: "pool-report", project: null, product: "store", node: "门店报表", title: "多门店经营对比报表", status: "req_in_progress", priority: "p2", start: 20, end: 50, proposer: "zhou", people: {}, summary: "区域经理同时查看多家门店的销售额、毛利和人效排名。" },
];

export type BugDef = {
  project: string;
  req?: string;
  title: string;
  status: string;
  severity: string;
  assignee: PersonaKey;
  creator: PersonaKey;
  env: string;
  device?: string;
  version?: string;
  reopen?: number;
  due?: number;
  summary: string;
  comments?: [PersonaKey, string][];
};

export const BUGS: BugDef[] = [
  { project: "mall", req: "m-coupon", title: "平台券和满减同时使用时实付金额多扣 0.01 元", status: "resolved", severity: "critical", assignee: "zheng", creator: "feng", env: "测试", version: "2.4.0", reopen: 1, summary: "满 199 减 30 + 平台券 15 元，商品 199.01 元时实付显示 154.02，应为 154.01。四舍五入发生在两次。", comments: [["zheng", "分摊时先按商品四舍五入再求和导致，改为最后一次性取整。"], ["feng", "回归通过，补了 6 条边界用例。"]] },
  { project: "mall", req: "m-coupon", title: "优惠明细里店铺券名称显示为 undefined", status: "open", severity: "major", assignee: "sun", creator: "feng", env: "测试", device: "iPhone 15 / iOS 18", version: "2.4.0", due: 2, summary: "店铺券没有配置副标题时，结算页优惠明细显示 undefined。" },
  { project: "mall", req: "m-video", title: "详情页视频在安卓微信内无法自动播放", status: "in_progress", severity: "major", assignee: "wu", creator: "feng", env: "测试", device: "小米 14 / 微信 8.0", version: "2.4.0", due: 1, summary: "微信内置浏览器禁止自动播放，需要改为首帧封面 + 点击播放。", comments: [["wu", "已确认是 X5 内核限制，改成点击播放并加播放按钮。"]] },
  { project: "mall", req: "m-video", title: "视频静音图标与收藏按钮重叠", status: "open", severity: "minor", assignee: "wu", creator: "feng", env: "测试", device: "iPhone SE", version: "2.4.0", summary: "小屏手机上静音图标压住收藏按钮，收藏点不到。" },
  { project: "mall", req: "m-filter", title: "筛选后返回列表，滚动位置丢失", status: "reopened", severity: "major", assignee: "sun", creator: "feng", env: "测试", version: "2.4.0", reopen: 2, summary: "进入商品详情后返回，列表回到顶部。第一次修复只处理了 iOS。", comments: [["feng", "安卓上仍然复现，重新打开。"]] },
  { project: "mall", req: "m-orders", title: "订单列表在 iOS 14 上白屏", status: "closed", severity: "blocker", assignee: "sun", creator: "xu", env: "生产", device: "iPhone 8 / iOS 14", version: "2.3.0", summary: "可选链语法未转译导致旧系统白屏，已在 2.3.1 修复。" },
  { project: "mall", req: "m-floor", title: "楼层拖拽排序后预览未刷新", status: "in_progress", severity: "minor", assignee: "sun", creator: "chen", env: "开发", summary: "拖拽调整顺序后需要手动刷新才能看到新顺序。" },
  { project: "mall", title: "首页轮播图在暗色模式下文字看不清", status: "cancelled", severity: "trivial", assignee: "wu", creator: "xu", env: "生产", summary: "设计确认轮播图不适配暗色模式，按设计如此处理。" },
  { project: "store", req: "s-offline", title: "离线盘点数据联网后重复上传", status: "in_progress", severity: "critical", assignee: "he", creator: "feng", env: "测试", device: "PDA i6310", version: "1.5.0", due: 3, summary: "网络在上传过程中断开再恢复，同一批扫码记录上传了两次，库存差异翻倍。", comments: [["he", "加上批次号做幂等，服务端按批次号去重。"]] },
  { project: "store", req: "s-shift", title: "交班对账单退款金额未扣除手续费", status: "open", severity: "major", assignee: "he", creator: "feng", env: "测试", version: "1.5.0", due: 1, summary: "部分退款时手续费没有按比例退回，对账差额 0.6%。" },
  { project: "store", req: "s-shift", title: "对账单打印时金额列错位", status: "resolved", severity: "minor", assignee: "wu", creator: "feng", env: "测试", device: "收银一体机 T2", version: "1.5.0", summary: "58mm 小票纸上金额列超出宽度换行。" },
  { project: "store", req: "s-pay", title: "云闪付付款码偶尔识别为条形码", status: "closed", severity: "major", assignee: "he", creator: "xu", env: "生产", version: "1.4.0", summary: "19 位付款码被当成商品条码查询，已按前缀区分。" },
  { project: "store", req: "s-notice", title: "紧急提醒在锁屏时不响铃", status: "open", severity: "critical", assignee: "wu", creator: "zhou", env: "测试", device: "华为 Mate 60", version: "1.5.0", due: 2, summary: "鸿蒙系统需要单独申请通知渠道权限。" },
  { project: "points", req: "p-deduct", title: "积分抵扣后取消订单，积分未退回", status: "in_progress", severity: "blocker", assignee: "zheng", creator: "feng", env: "测试", version: "1.1.0", due: 1, summary: "未支付取消时退回了积分，已支付后取消没有退回。", comments: [["zheng", "退款回调里漏了积分退回，正在补。"], ["chen", "这个是资损问题，修复后需要把测试期间的数据核对一遍。"]] },
  { project: "points", req: "p-mall", title: "兑换库存为 1 时并发兑换超卖", status: "resolved", severity: "critical", assignee: "zheng", creator: "feng", env: "测试", version: "1.1.0", reopen: 1, summary: "两人同时兑换最后一件，都兑换成功。改为数据库条件更新扣库存。" },
  { project: "points", req: "p-level", title: "等级进度条在 100% 时溢出", status: "closed", severity: "trivial", assignee: "sun", creator: "chen", env: "生产", version: "1.0.0", summary: "进度超过 100% 时进度条超出卡片。" },
];

export type ReleaseDef = {
  project: string;
  version: string;
  title: string;
  status: "planning" | "frozen" | "releasing" | "released";
  kind?: "normal" | "hotfix";
  at: number;
  reqs: string[];
  bugs?: string[];
  reason?: string;
  creator: PersonaKey;
  description: string;
};

export const RELEASES: ReleaseDef[] = [
  { project: "mall", version: "2.3.0", title: "售后与订单体验", status: "released", at: -14, reqs: ["m-spec", "m-return", "m-orders"], creator: "wang", description: "图片规格、退货凭证、订单列表提速。" },
  { project: "mall", version: "2.3.1", title: "修复 iOS 14 订单列表白屏", status: "released", kind: "hotfix", at: -12, reqs: [], bugs: ["订单列表在 iOS 14 上白屏"], reason: "线上 iOS 14 用户（约 3%）打开订单列表白屏，影响查单和售后。", creator: "zhao", description: "紧急修复旧系统兼容问题。" },
  { project: "mall", version: "2.4.0", title: "大促前置版本", status: "frozen", at: 3, reqs: ["m-video", "m-filter", "m-coupon", "m-address"], creator: "wang", description: "详情页视频、搜索筛选、优惠叠加、地址识别。已冻结，只修 Bug。" },
  { project: "mall", version: "2.5.0", title: "双 11 大促会场", status: "planning", at: 17, reqs: ["m-countdown", "m-poster", "m-floor", "m-suggest"], creator: "wang", description: "大促会场、楼层配置和搜索联想。" },
  { project: "store", version: "1.4.0", title: "聚合支付", status: "released", at: -20, reqs: ["s-pay", "s-receipt"], creator: "wang", description: "聚合扫码支付和小票模板。" },
  { project: "store", version: "1.5.0", title: "交班与提醒", status: "releasing", at: 0, reqs: ["s-shift", "s-notice", "s-daily"], creator: "wang", description: "交班对账、提醒分级和销售日报。今晚分批推送到门店。" },
  { project: "store", version: "1.6.0", title: "离线盘点", status: "planning", at: 24, reqs: ["s-offline", "s-review"], creator: "wang", description: "离线盘点和差异审核。" },
  { project: "points", version: "1.0.0", title: "会员等级", status: "released", at: -9, reqs: ["p-level"], creator: "zhou", description: "会员等级与权益页。" },
  { project: "points", version: "1.1.0", title: "积分抵扣与兑换", status: "planning", at: 10, reqs: ["p-deduct", "p-mall", "p-rules"], creator: "zhou", description: "积分抵扣、积分商城和规则后台。" },
];

/** 文档页（Markdown，生成时转成文档 HTML）；children 是子页面；primaryOf 设为某个需求的主需求文档 */
export type DocDef = { title: string; author: PersonaKey; md: string; status?: "draft" | "review" | "approved"; primaryOf?: string; group?: "product" | "dev" | "project"; children?: DocDef[] };

export const DOCS: Record<string, DocDef[]> = {
  mall: [
    {
      title: "项目概览",
      author: "wang",
      status: "approved",
      md: [
        "> **项目目标**",
        ">",
        "> 双 11 前完成商城首页、详情和结算链路改版，大促期间下单转化率提升 15%，结算页跳出率下降 20%。",
        "",
        "## 里程碑",
        "",
        "| 里程碑 | 版本 | 计划日期 | 状态 |",
        "| --- | --- | --- | --- |",
        "| 售后与订单体验 | 2.3.0 | 已上线 | 完成 |",
        "| 大促前置版本 | 2.4.0 | 3 天后 | 已冻结 |",
        "| 双 11 大促会场 | 2.5.0 | 17 天后 | 规划中 |",
        "",
        "## 交付流程",
        "",
        "```mermaid",
        "flowchart LR",
        '  A["需求评审"] --> B["技术方案"]',
        '  B --> C["开发"]',
        '  C --> D["提测"]',
        '  D -->|"测试通过"| E["冻结版本"]',
        '  D -->|"有阻塞 Bug"| C',
        '  E --> F["周四晚上线"]',
        "```",
        "",
        "## 角色分工",
        "",
        "| 角色 | 负责人 | 说明 |",
        "| --- | --- | --- |",
        "| 项目经理 | 王磊 | 排期、发版、风险跟踪 |",
        "| 产品经理 | 陈晨 | 需求、PRD、验收 |",
        "| 技术负责人 | 赵航 | 技术方案、代码评审 |",
        "| 测试 | 冯雪 | 测试用例、回归、上线验证 |",
        "",
        "## 风险",
        "",
        "- 优惠叠加涉及资损，2.4.0 必须完成全部边界用例才能上线。",
        "- 大促流量预计是平时的 8 倍，需要在 2.5.0 前完成一次全链路压测。",
      ].join("\n"),
    },
    {
      title: "PRD · 优惠券与满减叠加计算",
      group: "product",
      author: "chen",
      status: "approved",
      primaryOf: "m-coupon",
      md: [
        "> **结论**",
        ">",
        "> 按「单品优惠 → 店铺满减 → 店铺券 → 平台券」的顺序计算，每一步基于上一步的结果；最后一步统一取整到分。",
        "",
        "## 背景",
        "",
        "大促期间同时存在满减、店铺券和平台券，现在各自独立计算，叠加时多次四舍五入，出现过实付金额差 1 分的客诉。",
        "",
        "## 计算顺序",
        "",
        "```mermaid",
        "flowchart TD",
        '  A["商品原价合计"] --> B["单品优惠"]',
        '  B --> C["店铺满减"]',
        '  C --> D["店铺券"]',
        '  D --> E["平台券"]',
        '  E --> F["取整到分，得到实付"]',
        "```",
        "",
        "## 公式",
        "",
        "$$",
        "\\text{实付} = \\max\\left(0.01,\\ \\left(P - D_{单品} - D_{满减} - C_{店铺} - C_{平台}\\right)\\right)",
        "$$",
        "",
        "其中 P 为商品原价合计，单位元；任何情况下实付不低于 0.01 元。",
        "",
        "## 规则",
        "",
        "| 编号 | 规则 | 说明 |",
        "| --- | --- | --- |",
        "| R1 | 每单最多使用 1 张店铺券和 1 张平台券 | 多张时默认选优惠最大的组合 |",
        "| R2 | 满减门槛按单品优惠后的金额判断 | 不按原价 |",
        "| R3 | 优惠分摊到商品按金额比例 | 售后按分摊后的金额退款 |",
        "| R4 | 只在最后一步取整 | 修复 1 分钱差异 |",
        "",
        "## 验收标准",
        "",
        "| 场景 | 预期 |",
        "| --- | --- |",
        "| 满 199 减 30 + 平台券 15，商品 199.01 元 | 实付 154.01 元 |",
        "| 券面额大于剩余金额 | 实付 0.01 元，券不拆分不退回 |",
        "| 部分退款 | 按分摊后金额退款，券不退回 |",
      ].join("\n"),
    },
    {
      title: "技术方案 · 首页楼层组件",
      group: "dev",
      author: "zhao",
      status: "review",
      md: [
        "本文说明首页楼层可视化配置的技术方案，评审通过后进入开发。",
        "",
        "## 发布时序",
        "",
        "```mermaid",
        "sequenceDiagram",
        '  participant O as "运营后台"',
        '  participant S as "配置服务"',
        '  participant C as "CDN"',
        '  participant A as "商城首页"',
        "  O->>S: 保存草稿",
        "  O->>S: 预览（生成临时版本）",
        "  O->>S: 发布",
        "  S->>C: 推送楼层 JSON",
        "  A->>C: 读取楼层 JSON（缓存 60 秒）",
        "```",
        "",
        "## 数据结构",
        "",
        "```json",
        "{",
        '  "version": 12,',
        '  "floors": [',
        '    { "type": "banner", "items": ["b-101", "b-102"] },',
        '    { "type": "goods", "title": "今日好物", "skuIds": [1001, 1002, 1003] }',
        "  ]",
        "}",
        "```",
        "",
        "> **注意**",
        ">",
        "> 发布前校验商品是否下架，下架商品不渲染；楼层 JSON 不超过 200 KB。",
      ].join("\n"),
    },
    {
      title: "会议纪要",
      author: "wang",
      md: "项目例会和评审会的纪要都放在这里，按日期命名。",
      children: [
        {
          title: "2.4.0 版本评审",
          author: "wang",
          md: [
            "**参会**：王磊、陈晨、赵航、孙婷、郑凯、冯雪",
            "",
            "## 结论",
            "",
            "- 2.4.0 范围确定为 4 个需求，按计划冻结。",
            "- 优惠叠加的回归用例由冯雪补齐到 40 条，郑凯配合造数。",
            "",
            "## 待办",
            "",
            "| 事项 | 负责人 | 截止 |",
            "| --- | --- | --- |",
            "| 补齐优惠叠加回归用例 | 冯雪 | 冻结前 |",
            "| 安卓微信视频播放方案 | 吴涛 | 明天 |",
            "| 发版检查清单 | 王磊 | 上线前一天 |",
          ].join("\n"),
        },
        {
          title: "大促筹备周会",
          author: "zhou",
          md: [
            "## 进展",
            "",
            "- 会场设计稿已定稿，倒计时组件开发中。",
            "- 压测环境下周一准备好。",
            "",
            "> **风险**",
            ">",
            "> 分享海报依赖小程序码接口，接口有每分钟 5000 次的限制，需要提前生成。",
          ].join("\n"),
        },
      ],
    },
    {
      title: "发版说明 · 2.3.0",
      author: "wang",
      status: "approved",
      md: ["## 新功能", "", "- 规格选择改为图片规格", "- 退货申请支持上传凭证", "", "## 优化", "", "- 订单列表首屏从 2.4 秒降到 0.8 秒", "", "## 已知问题", "", "- iOS 14 订单列表白屏，已在 2.3.1 修复"].join("\n"),
    },
  ],
  store: [
    {
      title: "项目概览",
      author: "wang",
      status: "approved",
      md: [
        "> **项目目标**",
        ">",
        "> 让门店在弱网环境下也能完成盘点和收银，交班对账从 20 分钟缩短到 5 分钟。",
        "",
        "## 版本计划",
        "",
        "| 版本 | 内容 | 状态 |",
        "| --- | --- | --- |",
        "| 1.4.0 | 聚合支付、小票模板 | 已上线 |",
        "| 1.5.0 | 交班对账、提醒分级、销售日报 | 发布中 |",
        "| 1.6.0 | 离线盘点、差异审核 | 规划中 |",
        "",
        "## 灰度策略",
        "",
        "先推 5 家试点门店，观察 2 天无问题再推全部门店。",
      ].join("\n"),
    },
    {
      title: "PRD · 扫码盘点支持离线",
      group: "product",
      author: "lin",
      status: "review",
      primaryOf: "s-offline",
      md: [
        "## 背景",
        "",
        "门店仓库普遍信号差，盘点时经常扫码失败，店员只能手写再补录，一次盘点要多花 1 小时。",
        "",
        "## 离线同步流程",
        "",
        "```mermaid",
        "sequenceDiagram",
        '  participant P as "PDA"',
        '  participant L as "本地数据库"',
        '  participant S as "库存服务"',
        "  P->>L: 扫码记录（带批次号）",
        "  Note over P,L: 离线时只写本地",
        "  P->>S: 联网后按批次上传",
        "  S-->>P: 已处理的批次号",
        "  P->>L: 删除已上传批次",
        "```",
        "",
        "## 规则",
        "",
        "| 编号 | 规则 |",
        "| --- | --- |",
        "| R1 | 本地最多缓存 5000 条扫码记录 |",
        "| R2 | 同一批次重复上传时服务端忽略 |",
        "| R3 | 同一商品多人盘点时，以最后提交的为准并提示 |",
      ].join("\n"),
    },
    {
      title: "测试计划 · 1.5.0",
      group: "dev",
      author: "feng",
      md: [
        "## 范围",
        "",
        "交班对账、消息提醒分级、销售日报。",
        "",
        "## 设备",
        "",
        "| 设备 | 系统 | 用途 |",
        "| --- | --- | --- |",
        "| 收银一体机 T2 | Android 11 | 交班打印 |",
        "| 华为 Mate 60 | 鸿蒙 4 | 提醒 |",
        "| iPhone 15 | iOS 18 | 提醒、日报 |",
        "",
        "## 准入准出",
        "",
        "- 准入：冒烟用例全部通过。",
        "- 准出：没有未关闭的严重及以上 Bug，一般 Bug 不超过 3 个且有规避方案。",
      ].join("\n"),
    },
    {
      title: "接口约定 · 库存服务",
      group: "dev",
      author: "he",
      md: [
        "## 数据模型",
        "",
        "```mermaid",
        "erDiagram",
        '  STORE ||--o{ STOCKTAKE : "发起"',
        '  STOCKTAKE ||--|{ STOCKTAKE_ITEM : "包含"',
        '  SKU ||--o{ STOCKTAKE_ITEM : "被盘点"',
        "```",
        "",
        "## 上传盘点记录",
        "",
        "```http",
        "POST /api/stocktakes/{id}/items",
        "Content-Type: application/json",
        "",
        '{ "batchNo": "P2-20261117-0012", "items": [{ "sku": "6901234567890", "qty": 12 }] }',
        "```",
      ].join("\n"),
    },
  ],
  points: [
    {
      title: "PRD · 积分抵扣下单",
      group: "product",
      author: "chen",
      status: "approved",
      primaryOf: "p-deduct",
      md: [
        "> **关键规则**",
        ">",
        "> 100 积分抵 1 元，单笔最多抵扣订单金额的 20%；取消或退款时积分原路退回。",
        "",
        "## 抵扣上限",
        "",
        "$$",
        "\\text{可抵扣积分} = \\min\\left(\\text{可用积分},\\ \\lfloor 0.2 \\times \\text{实付} \\times 100 \\rfloor\\right)",
        "$$",
        "",
        "实付指使用优惠券之后的金额，单位元。",
        "",
        "## 积分状态",
        "",
        "```mermaid",
        "stateDiagram-v2",
        "  [*] --> 可用",
        "  可用 --> 冻结: 下单抵扣",
        "  冻结 --> 已使用: 支付成功",
        "  冻结 --> 可用: 取消订单",
        "  已使用 --> 可用: 退款退回",
        "  可用 --> 已过期: 到期",
        "```",
        "",
        "## 验收标准",
        "",
        "| 场景 | 预期 |",
        "| --- | --- |",
        "| 实付 100 元，可用积分 5000 | 最多抵扣 2000 积分（20 元） |",
        "| 支付后取消订单 | 积分退回，流水记录「退款退回」 |",
        "| 部分退款 | 按退款金额比例退回积分 |",
      ].join("\n"),
    },
    {
      title: "积分规则说明（对外）",
      group: "product",
      author: "lin",
      md: [
        "## 怎么获得积分",
        "",
        "| 行为 | 积分 | 上限 |",
        "| --- | --- | --- |",
        "| 每消费 1 元 | 1 | 无 |",
        "| 评价晒图 | 20 | 每天 3 次 |",
        "| 每日签到 | 5 | 每天 1 次 |",
        "",
        "## 有效期",
        "",
        "积分自获得之日起 12 个月内有效，到期前 30 天和 7 天会提醒。",
      ].join("\n"),
    },
  ],
};

/** 需求评论 */
export const REQ_COMMENTS: [string, PersonaKey, string][] = [
  ["m-coupon", "zheng", "满减门槛按单品优惠后金额判断，这点和财务确认过了吗？"],
  ["m-coupon", "chen", "确认过，财务那边按实收入账，按优惠后金额判断没问题。"],
  ["m-floor", "zhao", "楼层 JSON 放 CDN，预览走临时版本号，不影响线上。"],
  ["m-video", "feng", "安卓微信内自动播放受限，验收标准里改成「点击播放」可以吗？"],
  ["m-video", "chen", "可以，已更新 PRD。"],
  ["s-offline", "he", "本地缓存上限 5000 条够用吗？大店一次盘点可能上万条。"],
  ["s-offline", "lin", "大店分区盘点，单次不会超过 5000，先按这个做。"],
  ["p-deduct", "feng", "积分抵扣和优惠券同时使用时，20% 是按券后金额算吧？"],
  ["p-deduct", "chen", "对，按券后实付算，PRD 里补了公式。"],
];

/** 每个项目上周的周报 */
export const REPORTS: Record<string, { done: string; next: string; risks: string; progress: number; author: PersonaKey }> = {
  mall: { done: "2.3.1 紧急修复上线；2.4.0 完成冻结，进入回归。", next: "2.4.0 上线；大促会场倒计时组件提测。", risks: "优惠叠加资损风险，需要回归用例全部通过才上线。", progress: 55, author: "wang" },
  store: { done: "交班对账提测；提醒分级开发完成。", next: "1.5.0 分批推送门店；离线盘点联调。", risks: "鸿蒙通知权限问题待解决。", progress: 62, author: "wang" },
  points: { done: "会员等级上线；积分规则后台测试通过。", next: "积分抵扣联调；积分商城回归。", risks: "积分退回漏洞需要修复后核对测试数据。", progress: 40, author: "zhou" },
};

/** 产品资料空间（每个产品一个）里的文档 */
export const PRODUCT_DOCS: Record<string, DocDef[]> = {
  mall: [
    {
      title: "产品路线图",
      author: "chen",
      group: "product",
      status: "approved",
      md: [
        "> **本季度重点**",
        ">",
        "> 先保证大促稳定，再做会员积分；小程序首页改版排到下个季度。",
        "",
        "| 季度 | 主题 | 关键需求 | 状态 |",
        "| --- | --- | --- | --- |",
        "| 本季度 | 大促与结算体验 | 楼层配置、优惠叠加、详情页视频 | 进行中 |",
        "| 本季度 | 会员积分 | 积分抵扣、积分商城、等级权益 | 进行中 |",
        "| 下季度 | 多端统一 | 小程序首页改版、礼品卡支付 | 规划中 |",
        "",
        "## 优先级原则",
        "",
        "1. 资损、合规问题最优先。",
        "2. 大促相关需求在大促前两周冻结。",
        "3. 其余按「影响用户数 × 频次」排序。",
      ].join("\n"),
    },
    {
      title: "前端组件规范",
      author: "zhao",
      group: "dev",
      md: [
        "## 组件分层",
        "",
        "```mermaid",
        "flowchart TD",
        '  A["页面"] --> B["业务组件（商品卡、优惠明细）"]',
        '  B --> C["基础组件（按钮、弹窗、表单）"]',
        '  C --> D["设计变量（颜色、间距、字号）"]',
        "```",
        "",
        "## 约定",
        "",
        "| 项目 | 约定 |",
        "| --- | --- |",
        "| 金额 | 一律用分存储，展示时保留两位小数 |",
        "| 图片 | 列表用 WebP 缩略图，详情页按屏宽取图 |",
        "| 埋点 | 点击类事件统一走 track(event, props) |",
      ].join("\n"),
    },
  ],
  store: [
    {
      title: "门店助手使用手册",
      author: "xu",
      group: "project",
      status: "approved",
      md: [
        "给门店新员工的上手说明。",
        "",
        "## 每天要做的事",
        "",
        "| 时间 | 事项 | 入口 |",
        "| --- | --- | --- |",
        "| 开店前 | 查看今日待办和缺货提醒 | 工作台 |",
        "| 营业中 | 扫码收银、处理退款 | 收银台 |",
        "| 闭店后 | 交班对账、打印对账单 | 收银台 › 交班 |",
        "",
        "> **常见问题**",
        ">",
        "> 扫码枪没反应时先检查是否切到了英文输入法，再重新插拔。",
      ].join("\n"),
    },
    {
      title: "版本规划",
      author: "lin",
      group: "product",
      md: ["| 版本 | 时间 | 主题 |", "| --- | --- | --- |", "| 1.5 | 本月 | 交班与提醒 |", "| 1.6 | 下月 | 离线盘点 |", "| 1.7 | 下季度 | 员工排班 |"].join("\n"),
    },
  ],
};

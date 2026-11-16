import { prisma } from "@pm-collab/db/prisma";
import { getHiddenStatuses } from "./req-stages";
import { remapHiddenStatus } from "./req-stages-shared";
import { REQ_STATUS, REQ_STATUS_LEGACY_MAP } from "./constants";

/** 从环境变量读取 ITR 表格来源；不再写死真实 wiki / token / sheet id。 */
function envTrim(name: string): string {
  return (process.env[name] || "").trim();
}

function envOrDefault(name: string, fallback: string): string {
  return envTrim(name) || fallback;
}

/**
 * ITR 文档定位配置。
 * - FEISHU_ITR_WIKI_URL / FEISHU_ITR_SPREADSHEET_TOKEN / FEISHU_ITR_SHEET_ID 必填才可同步
 * - FEISHU_ITR_SHEET_TITLE / FEISHU_ITR_SOURCE_TITLE 可选，有中性默认值
 * 访问属性时不会抛错；需要同步时请先调 assertItrDocConfigured()。
 */
export const ITR_DOC = {
  get wikiUrl() {
    return envTrim("FEISHU_ITR_WIKI_URL");
  },
  get spreadsheetToken() {
    return envTrim("FEISHU_ITR_SPREADSHEET_TOKEN");
  },
  get sheetId() {
    return envTrim("FEISHU_ITR_SHEET_ID");
  },
  get sheetTitle() {
    return envOrDefault("FEISHU_ITR_SHEET_TITLE", "开发计划排期");
  },
  get sourceTitle() {
    return envOrDefault("FEISHU_ITR_SOURCE_TITLE", "开发进度排期表");
  },
};

/** 同步前校验：缺配置时抛出可读错误，消息里不含任何敏感值。 */
export function assertItrDocConfigured(): void {
  const missing: string[] = [];
  if (!ITR_DOC.spreadsheetToken) missing.push("FEISHU_ITR_SPREADSHEET_TOKEN");
  if (!ITR_DOC.sheetId) missing.push("FEISHU_ITR_SHEET_ID");
  if (!ITR_DOC.wikiUrl) missing.push("FEISHU_ITR_WIKI_URL");
  if (missing.length) {
    throw new Error(
      `排期表同步未配置：请在环境变量中设置 ${missing.join("、")}（也可用 FEISHU_ITR_SHEET_TITLE / FEISHU_ITR_SOURCE_TITLE 覆盖展示名）`,
    );
  }
}

export type ItrSheetRow = {
  row: number;
  seq?: string;
  module?: string;
  featureModule?: string;
  feature?: string;
  priority?: string;
  status?: string;
  plannedOnlineAt?: string;
  onlineAt?: string;
  plannedEndAt?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  feProgress?: string;
  beProgress?: string;
  qaProgress?: string;
  owner?: string;
  frontend?: string;
  backend?: string;
  remark?: string;
  zentaoId?: string;
  relatedSystems?: string;
};

const VALID_STATUS: Set<string> = new Set(REQ_STATUS.map((s) => s.key));

export function externalKeyForRow(row: number) {
  return `itr-sheet:${ITR_DOC.sheetId}:row:${row}`;
}

export function buildTitle(r: ItrSheetRow) {
  const parts = [r.module, r.featureModule, r.feature]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  const deduped: string[] = [];
  for (const p of parts) {
    if (deduped[deduped.length - 1] !== p) deduped.push(p);
  }
  return deduped.join(" · ") || `ITR排期第${r.row}行`;
}

export function mapStatus(raw?: string) {
  const s = (raw || "").trim();
  if (!s) return "req_in_progress";
  if (VALID_STATUS.has(s)) return s;
  // 旧中文 / 英文 → 新阶段状态
  const legacy = REQ_STATUS_LEGACY_MAP[s];
  if (legacy) return legacy;
  // soft aliases
  if (s === "完成" || s === "已完结") return "test_done";
  if (s === "取消" || s === "废弃") return "cancelled";
  if (s.includes("内测")) return "online";
  if (s.includes("上线")) return "online";
  if (s.includes("测试")) return s.includes("完") ? "test_done" : s.includes("待") ? "test_todo" : "test_in_progress";
  if (s.includes("开发")) return s.includes("完") ? "dev_done" : s.includes("待") ? "dev_todo" : "dev_in_progress";
  if (s.includes("需求")) return s.includes("完") ? "req_done" : "req_in_progress";
  return "req_in_progress";
}

export function mapPriority(raw?: string) {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "p2";
  if (["p0", "紧急", "最高"].includes(s)) return "p0";
  if (["p1", "高"].includes(s)) return "p1";
  if (["p2", "中"].includes(s)) return "p2";
  if (["p3", "低"].includes(s)) return "p3";
  if (/^p[0-3]$/.test(s)) return s;
  return "p2";
}

export function parseSheetDate(raw?: string): Date | null {
  const s = (raw || "").trim();
  if (!s) return null;
  // Excel serial (Feishu sometimes returns number as string)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      // days since 1899-12-30
      const ms = Date.UTC(1899, 11, 30, 12) + Math.round(n) * 86400000;
      return new Date(ms);
    }
  }
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildSummary(r: ItrSheetRow) {
  const bits: string[] = [];
  if (r.remark) bits.push(r.remark);
  const prog: string[] = [];
  if (r.feProgress) prog.push(`前端 ${r.feProgress}`);
  if (r.beProgress) prog.push(`后端 ${r.beProgress}`);
  if (r.qaProgress) prog.push(`测试 ${r.qaProgress}`);
  if (prog.length) bits.push(`进度：${prog.join("，")}`);
  if (r.zentaoId) bits.push(`禅道：${r.zentaoId}`);
  if (r.relatedSystems) bits.push(`关联系统：${r.relatedSystems}`);
  if (r.seq) bits.push(`排期序号：${r.seq}`);
  bits.push(`来源：${ITR_DOC.sourceTitle} 第${r.row}行`);
  return bits.join("\n") || null;
}

function buildTags(r: ItrSheetRow) {
  const tags = ["ITR排期", ITR_DOC.sheetTitle];
  if (r.module) tags.push(r.module);
  if (r.featureModule) tags.push(r.featureModule);
  if (r.zentaoId) tags.push(`禅道:${r.zentaoId}`);
  if (r.relatedSystems) {
    for (const part of r.relatedSystems.split(/[,，、/\s]+/).filter(Boolean)) {
      tags.push(part);
    }
  }
  return JSON.stringify(Array.from(new Set(tags)));
}

function docUrlForRow(row: number) {
  const wiki = ITR_DOC.wikiUrl;
  const sheetId = ITR_DOC.sheetId;
  if (!wiki || !sheetId) return null;
  return `${wiki}?sheet=${sheetId}#row=${row}`;
}

async function resolveUserIdByName(
  name: string | undefined,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const n = (name || "").trim();
  if (!n) return null;
  if (cache.has(n)) return cache.get(n) || null;
  // exact first
  let user = await prisma.user.findFirst({ where: { name: n, isActive: true } });
  if (!user) {
    // prefix match "Name(alias)" style — sheet uses plain Chinese names
    user = await prisma.user.findFirst({ where: { isActive: true, OR: [{ name: { startsWith: n } }, { name: { contains: `(${n})` } }] } });
  }
  cache.set(n, user?.id || null);
  return user?.id || null;
}

export type SyncItrResult = {
  projectId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export async function syncItrRows(
  rows: ItrSheetRow[],
  opts?: { actorId?: string; dryRun?: boolean },
): Promise<SyncItrResult> {
  assertItrDocConfigured();
  // 同步目标以 projects.key=ITR 定位（稳定标识）；展示名一律读 Project.name，改名不影响同步归属
  const project =
    (await prisma.project.findUnique({ where: { key: "ITR" } })) ||
    (await prisma.project.findFirst({ where: { name: "ITR" } }));
  if (!project) {
    throw new Error("未找到 ITR 项目（projects.key=ITR），请先 seed 或创建 key=ITR 的项目");
  }

  let actorId = opts?.actorId;
  if (!actorId) {
    const admin = await prisma.user.findFirst({
      where: { OR: [{ email: "admin@local" }, { globalRole: "admin" }] },
      orderBy: { createdAt: "asc" },
    });
    actorId = admin?.id;
  }
  if (!actorId) throw new Error("无可用 creator 用户");

  const nameCache = new Map<string, string | null>();
  const result: SyncItrResult = {
    projectId: project.id,
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // 停用的需求阶段（Figma 52）：同步进来的状态落到之后第一个启用的阶段
  const hiddenStatuses = await getHiddenStatuses();
  for (const r of rows) {
    try {
      if (!r.row || (!r.module && !r.featureModule && !r.feature)) {
        result.skipped += 1;
        continue;
      }
      const key = externalKeyForRow(r.row);
      const title = buildTitle(r);
      const status = remapHiddenStatus(mapStatus(r.status), hiddenStatuses);
      const priority = mapPriority(r.priority);
      const plannedEndAt =
        parseSheetDate(r.plannedEndAt) || parseSheetDate(r.plannedOnlineAt);
      const actualEndAt = parseSheetDate(r.actualEndAt) || parseSheetDate(r.onlineAt);
      const summary = buildSummary(r);
      const tags = buildTags(r);
      const docUrl = docUrlForRow(r.row);

      if (opts?.dryRun) {
        result.created += 1;
        continue;
      }

      const existing = await prisma.requirement.findUnique({ where: { externalKey: key } });
      let reqId: string;
      if (existing) {
        await prisma.requirement.update({
          where: { id: existing.id },
          data: {
            title,
            // 在系统里改过富文本描述的，以系统为准，不用表格里的摘要覆盖
            summary: existing.descriptionHtml ? existing.summary : summary,
            docUrl,
            projectId: project.id,
            status,
            priority,
            tags,
            plannedEndAt,
            actualEndAt,
            archivedAt: null,
          },
        });
        reqId = existing.id;
        result.updated += 1;
      } else {
        const created = await prisma.requirement.create({
          data: {
            title,
            summary,
            docUrl,
            projectId: project.id,
            status,
            priority,
            tags,
            plannedEndAt,
            actualEndAt,
            creatorId: actorId,
            externalKey: key,
          },
        });
        reqId = created.id;
        result.created += 1;
        await prisma.activityLog.create({
          data: {
            entityType: "requirement",
            entityId: reqId,
            action: "synced_from_itr",
            actorId,
            message: `从 ${ITR_DOC.sourceTitle} 同步创建`,
          },
        });
      }

      // refresh assignees by role
      const frontendId = await resolveUserIdByName(r.frontend, nameCache);
      const backendId = await resolveUserIdByName(r.backend, nameCache);
      const ownerId = await resolveUserIdByName(r.owner, nameCache);
      const desired: { role: string; userId: string }[] = [];
      if (frontendId) desired.push({ role: "frontend", userId: frontendId });
      if (backendId) desired.push({ role: "backend", userId: backendId });
      if (ownerId) desired.push({ role: "product", userId: ownerId });

      for (const a of desired) {
        await prisma.requirementAssignee.upsert({
          where: { requirementId_role: { requirementId: reqId, role: a.role } },
          create: { requirementId: reqId, role: a.role, userId: a.userId },
          update: { userId: a.userId },
        });
      }
    } catch (e) {
      result.errors.push(`row ${r.row}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

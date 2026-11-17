import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { mdToHtml } from "../delivery/blocks";
import { SYSTEM_ORG_ID } from "../shared/org-shared";
import { listDocGroups } from "../shared/doc-groups";
import { ensureProductSpaces } from "../docs/doc-spaces-query";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { BUGS, DEMO_EMAIL_DOMAIN, DEMO_ORG_CODE, DEMO_ORG_NAME, DEPARTMENTS, DOCS, PERSONAS, PRODUCT_DOCS, PRODUCTS, PROJECTS, RELEASES, REPORTS, REQUIREMENTS, REQ_COMMENTS, type DocDef, type NodeDef, type PersonaKey } from "./data";

/**
 * 演示组织：独立企业「示例科技」+ 示例成员 + 全套演示数据（产品、项目、需求、Bug、发版、文档、动态、周报）。
 * - 演示组织的 id 记在 system_settings.demoOrgId；
 * - 重置 / 删除只动演示组织里的数据（按演示企业的项目、产品和演示成员筛选），不碰其他企业；
 * - 示例成员（users.demoKind = persona）没有密码，不能登录；体验账号见 ./guests.ts。
 */

export const DEMO_ORG_KEY = "demoOrgId";
export const DEMO_BUILT_KEY = "demoBuiltAt";

const deny = () => ({ error: "只有系统超管可以操作", status: 403 });

export async function demoOrgId(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: DEMO_ORG_KEY } });
  if (!row?.value) return null;
  const org = await prisma.organization.findFirst({ where: { id: row.value, type: "enterprise" }, select: { id: true } });
  return org?.id ?? null;
}

async function setSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** 中午 12:00 UTC（只有日期的字段统一这样存） */
function day(offset: number) {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset, 12));
}
/** 某天的具体时刻（动态、评论用） */
function at(offset: number, hour = 10, minute = 0) {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset, hour - 8, minute));
  return d.getTime() > Date.now() ? new Date(Date.now() - 60_000) : d;
}

/** 演示组织里所有账号（示例成员、体验账号、部门成员） */
async function orgUserIds(orgId: string) {
  const depts = await prisma.organization.findMany({ where: { parentId: orgId }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { orgId: { in: [orgId, ...depts.map((d) => d.id)] } }, select: { id: true } });
  return users.map((u) => u.id);
}

/** 清空演示组织的业务数据（保留组织、部门和账号） */
async function wipe(orgId: string) {
  const userIds = await orgUserIds(orgId);
  const projectIds = (await prisma.project.findMany({ where: { enterpriseId: orgId }, select: { id: true } })).map((p) => p.id);
  const productIds = (await prisma.product.findMany({ where: { enterpriseId: orgId }, select: { id: true } })).map((p) => p.id);
  const reqIds = (
    await prisma.requirement.findMany({
      where: { OR: [{ projectId: { in: projectIds } }, { productId: { in: productIds } }, { creatorId: { in: userIds } }] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const bugIds = (
    await prisma.bug.findMany({
      where: { OR: [{ projectId: { in: projectIds } }, { productId: { in: productIds } }, { creatorId: { in: userIds } }, { requirementId: { in: reqIds } }] },
      select: { id: true },
    })
  ).map((b) => b.id);
  const releaseIds = (await prisma.release.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((r) => r.id);
  const pageIds = (await prisma.docPage.findMany({ where: { OR: [{ projectId: { in: projectIds } }, { creatorId: { in: userIds } }] }, select: { id: true } })).map((p) => p.id);
  const entityIds = [...projectIds, ...productIds, ...reqIds, ...bugIds, ...releaseIds, ...pageIds];

  await prisma.$transaction(
    async (tx) => {
      await tx.activityLog.deleteMany({ where: { OR: [{ entityId: { in: entityIds } }, { actorId: { in: userIds } }] } });
      await tx.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: entityIds } }] } });
      await tx.releaseBug.deleteMany({ where: { OR: [{ bugId: { in: bugIds } }, { releaseId: { in: releaseIds } }] } });
      await tx.bugComment.deleteMany({ where: { OR: [{ bugId: { in: bugIds } }, { authorId: { in: userIds } }] } });
      await tx.bug.deleteMany({ where: { id: { in: bugIds } } });
      await tx.requirementComment.deleteMany({ where: { OR: [{ requirementId: { in: reqIds } }, { authorId: { in: userIds } }] } });
      await tx.requirement.updateMany({ where: { id: { in: reqIds } }, data: { parentId: null, docPageId: null } });
      await tx.requirement.deleteMany({ where: { id: { in: reqIds } } });
      await tx.docGroup.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.projectReport.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.projectReportSchedule.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.releaseSchedule.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.docPage.updateMany({ where: { id: { in: pageIds } }, data: { parentId: null } });
      await tx.docPage.deleteMany({ where: { id: { in: pageIds } } });
      await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      await tx.product.deleteMany({ where: { id: { in: productIds } } });
      await tx.attachment.deleteMany({ where: { uploaderId: { in: userIds } } });
    },
    { timeout: 60_000 },
  );
}

/** 建演示企业和部门（已存在就复用） */
async function ensureOrg(): Promise<{ orgId: string; depts: Record<string, string> }> {
  let orgId = await demoOrgId();
  if (!orgId) {
    const taken = await prisma.organization.findFirst({ where: { parentId: SYSTEM_ORG_ID, name: DEMO_ORG_NAME }, select: { id: true } });
    const name = taken ? `${DEMO_ORG_NAME}（演示）` : DEMO_ORG_NAME;
    let code = DEMO_ORG_CODE;
    for (let i = 2; await prisma.organization.findUnique({ where: { code }, select: { id: true } }); i++) code = `${DEMO_ORG_CODE}${i}`;
    const sys = await prisma.organization.findUnique({ where: { id: SYSTEM_ORG_ID }, select: { id: true } });
    if (!sys) await prisma.organization.create({ data: { id: SYSTEM_ORG_ID, name: "Weavi Space", type: "system", sortOrder: 0 } });
    const last = await prisma.organization.findFirst({ where: { parentId: SYSTEM_ORG_ID }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const org = await prisma.organization.create({ data: { name, code, type: "enterprise", parentId: SYSTEM_ORG_ID, sortOrder: (last?.sortOrder ?? -1) + 1 }, select: { id: true } });
    orgId = org.id;
    await setSetting(DEMO_ORG_KEY, orgId);
  }
  const depts: Record<string, string> = {};
  for (const [i, d] of DEPARTMENTS.entries()) {
    const found = await prisma.organization.findFirst({ where: { parentId: orgId, name: d.name }, select: { id: true } });
    depts[d.key] = found ? found.id : (await prisma.organization.create({ data: { name: d.name, type: "department", parentId: orgId, sortOrder: i }, select: { id: true } })).id;
  }
  return { orgId, depts };
}

/** 示例成员：固定邮箱，存在就更新，不存在就建；没有密码，不能登录 */
async function ensurePersonas(depts: Record<string, string>) {
  const ids = {} as Record<PersonaKey, string>;
  for (const p of PERSONAS) {
    const email = `${p.key}@${DEMO_EMAIL_DOMAIN}`;
    const data = { name: p.name, globalRole: p.role, position: p.position, orgId: depts[p.dept], isActive: true, isDemo: false, demoKind: "persona", mustChangePassword: false };
    const u = await prisma.user.upsert({ where: { email }, create: { email, passwordHash: null, ...data }, update: data, select: { id: true } });
    ids[p.key] = u.id;
  }
  return ids;
}

function flatNodes(tree: NodeDef[]) {
  const out: { name: string; parent: string | null; type: string; depth: number }[] = [];
  const walk = (list: NodeDef[], parent: string | null, depth: number) => {
    for (const n of list) {
      const type = n.children?.length ? (depth === 0 ? "menu" : "module") : "feature";
      out.push({ name: n.name, parent, type, depth });
      if (n.children) walk(n.children, n.name, depth + 1);
    }
  };
  walk(tree, null, 0);
  return out;
}

/** 生成演示数据（调用前已清空） */
async function seed(orgId: string, who: Record<PersonaKey, string>) {
  const counts = { products: 0, projects: 0, requirements: 0, bugs: 0, releases: 0, docs: 0 };
  // 产品和功能结构
  const productIds: Record<string, string> = {};
  const nodeIds: Record<string, Record<string, string>> = {};
  for (const [i, p] of PRODUCTS.entries()) {
    let code = p.code;
    for (let n = 2; await prisma.product.findUnique({ where: { code }, select: { id: true } }); n++) code = `${p.code}-${n}`;
    const prod = await prisma.product.create({
      data: { name: p.name, code, enterpriseId: orgId, description: p.description, status: p.status, ownerId: who[p.owner], sortOrder: i, environments: JSON.stringify(p.envs), createdAt: day(-90) },
      select: { id: true },
    });
    productIds[p.key] = prod.id;
    counts.products++;
    await prisma.productIntro.create({ data: { productId: prod.id, html: mdToHtml(p.intro), updatedById: who[p.owner] } });
    nodeIds[p.key] = {};
    for (const [j, n] of flatNodes(p.tree).entries()) {
      const node = await prisma.productNode.create({
        data: { productId: prod.id, parentId: n.parent ? nodeIds[p.key][n.parent] : null, type: n.type, name: n.name, sortOrder: j, ownerId: who[p.owner] },
        select: { id: true },
      });
      nodeIds[p.key][n.name] = node.id;
    }
  }

  // 项目和成员
  const projectIds: Record<string, string> = {};
  for (const p of PROJECTS) {
    let key = p.projectKey;
    for (let n = 2; await prisma.project.findUnique({ where: { key }, select: { id: true } }); n++) key = `${p.projectKey}-${n}`;
    const proj = await prisma.project.create({
      data: { name: p.name, key, systemName: PRODUCTS.find((x) => x.key === p.product)!.name, description: p.description, status: "active", enterpriseId: orgId, productId: productIds[p.product], plannedEndAt: day(p.endIn), createdById: who.zhou, createdAt: day(-60) },
      select: { id: true },
    });
    projectIds[p.key] = proj.id;
    counts.projects++;
    await prisma.projectMember.createMany({ data: p.members.map((m) => ({ projectId: proj.id, userId: who[m], role: PERSONAS.find((x) => x.key === m)!.position })) });
    await prisma.activityLog.create({ data: { entityType: "project", entityId: proj.id, action: "created", actorId: who.zhou, message: `创建项目「${p.name}」`, createdAt: at(-60) } });
  }

  // 需求
  const reqIds: Record<string, string> = {};
  const order: Record<string, number> = {};
  for (const r of REQUIREMENTS) {
    const created = at(r.start - 6, 9 + (r.ref.length % 8), 15);
    const row = await prisma.requirement.create({
      data: {
        title: r.title,
        summary: r.summary,
        descriptionHtml: `<p>${r.summary.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
        projectId: r.project ? projectIds[r.project] : null,
        parentId: r.parent ? reqIds[r.parent] : null,
        productId: productIds[r.product],
        productNodeId: nodeIds[r.product][r.node] ?? null,
        status: r.status,
        priority: r.priority,
        creatorId: who[r.proposer],
        proposerId: who[r.proposer],
        boardOrder: (order[r.status] = (order[r.status] ?? 0) + 1),
        tags: r.tags?.length ? JSON.stringify(r.tags) : null,
        startAt: day(r.start),
        plannedEndAt: day(r.end),
        actualEndAt: r.doneAt !== undefined ? day(r.doneAt) : null,
        createdAt: created,
      },
      select: { id: true },
    });
    reqIds[r.ref] = row.id;
    counts.requirements++;
    const people = Object.entries(r.people) as [string, PersonaKey][];
    if (people.length) await prisma.requirementAssignee.createMany({ data: people.map(([role, k]) => ({ requirementId: row.id, userId: who[k], role })) });
    await prisma.activityLog.create({ data: { entityType: "requirement", entityId: row.id, action: "created", actorId: who[r.proposer], message: `创建需求「${r.title}」`, createdAt: created } });
    if (r.status !== "req_in_progress") {
      await prisma.activityLog.create({
        data: {
          entityType: "requirement",
          entityId: row.id,
          action: "status_changed",
          actorId: who[r.people.qa ?? r.people.product ?? r.proposer],
          fromValue: JSON.stringify({ status: "req_in_progress" }),
          toValue: JSON.stringify({ status: r.status }),
          message: "更新状态",
          createdAt: at(Math.min(r.doneAt ?? r.start + 3, -1), 15, 30),
        },
      });
    }
  }
  for (const [ref, who2, body] of REQ_COMMENTS) {
    const r = REQUIREMENTS.find((x) => x.ref === ref)!;
    await prisma.requirementComment.create({ data: { requirementId: reqIds[ref], authorId: who[who2], body: `<p>${body}</p>`, createdAt: at(Math.min(r.start, -1), 11 + (body.length % 6), 20) } });
  }

  // Bug
  const bugIds: Record<string, string> = {};
  for (const [i, b] of BUGS.entries()) {
    const req = b.req ? REQUIREMENTS.find((x) => x.ref === b.req) : undefined;
    const created = at(-(3 + (i % 9)), 14, 10);
    const row = await prisma.bug.create({
      data: {
        title: b.title,
        summary: b.summary,
        descriptionHtml: `<p>${b.summary}</p>`,
        projectId: projectIds[b.project],
        requirementId: b.req ? reqIds[b.req] : null,
        productId: req ? productIds[req.product] : productIds[PROJECTS.find((p) => p.key === b.project)!.product],
        productNodeId: req ? (nodeIds[req.product][req.node] ?? null) : null,
        environment: b.env,
        device: b.device ?? null,
        foundVersion: b.version ?? null,
        dueAt: b.due !== undefined ? day(b.due) : null,
        status: b.status,
        severity: b.severity,
        assigneeId: who[b.assignee],
        creatorId: who[b.creator],
        reopenCount: b.reopen ?? 0,
        boardOrder: i,
        createdAt: created,
      },
      select: { id: true },
    });
    bugIds[b.title] = row.id;
    counts.bugs++;
    await prisma.activityLog.create({ data: { entityType: "bug", entityId: row.id, action: "created", actorId: who[b.creator], message: `提交 Bug「${b.title}」`, createdAt: created } });
    for (const [j, [k, body]] of (b.comments ?? []).entries()) {
      await prisma.bugComment.create({ data: { bugId: row.id, authorId: who[k], body: `<p>${body}</p>`, createdAt: new Date(created.getTime() + (j + 1) * 3_600_000) } });
    }
  }

  // 发版
  for (const r of RELEASES) {
    const rel = await prisma.release.create({
      data: {
        projectId: projectIds[r.project],
        version: r.version,
        title: r.title,
        description: r.description,
        status: r.status,
        kind: r.kind ?? "normal",
        reason: r.reason ?? null,
        plannedAt: day(r.at),
        releasedAt: r.status === "released" ? at(r.at, 21, 30) : null,
        createdById: who[r.creator],
        createdAt: at(r.at - 14, 10),
        items: { create: r.reqs.map((ref, i) => ({ requirementId: reqIds[ref], sortOrder: i })) },
      },
      select: { id: true },
    });
    counts.releases++;
    if (r.bugs?.length) await prisma.releaseBug.createMany({ data: r.bugs.map((t) => ({ releaseId: rel.id, bugId: bugIds[t] })) });
    await prisma.activityLog.create({ data: { entityType: "release", entityId: rel.id, action: "created", actorId: who[r.creator], message: `创建发版 v${r.version}`, createdAt: at(r.at - 14, 10) } });
    if (r.status !== "planning") {
      await prisma.activityLog.create({
        data: { entityType: "release", entityId: rel.id, action: "status_changed", actorId: who[r.creator], fromValue: JSON.stringify({ status: "planning" }), toValue: JSON.stringify({ status: r.status }), message: "更新发版状态", createdAt: at(Math.min(r.at, 0), r.status === "released" ? 21 : 18, 40) },
      });
    }
  }

  // 文档
  const walkDocs = async (spaceId: string, list: DocDef[], parentId: string | null) => {
    const groups = parentId ? [] : await listDocGroups(spaceId);
    for (const [i, d] of list.entries()) {
      const groupId = parentId ? null : (groups.find((g) => g.key === (d.group ?? "project"))?.id ?? null);
      const html = mdToHtml(d.md);
      const when = at(-(20 - i * 3), 16, 0);
      const page = await prisma.docPage.create({
        data: {
          projectId: spaceId,
          parentId,
          groupId,
          title: d.title,
          body: html,
          statusTag: d.status ?? null,
          sortOrder: i,
          version: 1,
          viewCount: 12 + ((d.title.length * 7) % 60),
          creatorId: who[d.author],
          updatedById: who[d.author],
          publishedAt: when,
          createdAt: when,
          versions: { create: { version: 1, title: d.title, body: html, authorId: who[d.author], createdAt: when } },
        },
        select: { id: true },
      });
      counts.docs++;
      await prisma.activityLog.create({ data: { entityType: "doc", entityId: page.id, action: "created", actorId: who[d.author], message: `发布文档「${d.title}」`, createdAt: when } });
      if (d.primaryOf) await prisma.requirement.update({ where: { id: reqIds[d.primaryOf] }, data: { docPageId: page.id } });
      if (d.children) await walkDocs(spaceId, d.children, page.id);
    }
  };
  for (const [key, list] of Object.entries(DOCS)) await walkDocs(projectIds[key], list, null);
  // 产品资料空间（隐藏的 status = space 项目）和里面的文档
  const spaces = await ensureProductSpaces(Object.values(productIds));
  for (const [key, list] of Object.entries(PRODUCT_DOCS)) {
    const spaceId = spaces.get(productIds[key]);
    if (spaceId) await walkDocs(spaceId, list, null);
  }

  // 上周周报
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - 7));
  for (const [key, r] of Object.entries(REPORTS)) {
    await prisma.projectReport.create({ data: { projectId: projectIds[key], weekStart: monday, done: r.done, next: r.next, risks: r.risks, progress: r.progress, authorId: who[r.author] } });
  }
  return { counts, projectIds: Object.values(projectIds) };
}

/** 体验账号（只读 / 可编辑 / 一键体验）加入演示组织的全部项目 */
export async function joinDemoProjects(orgId: string, userIds?: string[]) {
  const guests = await prisma.user.findMany({
    where: { ...(userIds ? { id: { in: userIds } } : {}), demoKind: { in: ["readonly", "editable", "oneclick"] }, orgId },
    select: { id: true, position: true, demoKind: true },
  });
  const projects = await prisma.project.findMany({ where: { enterpriseId: orgId }, select: { id: true } });
  for (const g of guests) {
    const joined = new Set((await prisma.projectMember.findMany({ where: { userId: g.id }, select: { projectId: true } })).map((m) => m.projectId));
    const missing = projects.filter((p) => !joined.has(p.id));
    if (!missing.length) continue;
    await prisma.projectMember.createMany({ data: missing.map((p) => ({ projectId: p.id, userId: g.id, role: g.demoKind === "editable" ? g.position || "member" : "member" })), skipDuplicates: true });
    if (g.demoKind === "editable") await handOverWork(g.id, g.position, missing.map((p) => p.id));
  }
}

/** 可编辑体验账号：把同岗位示例成员手上几条没做完的需求和 Bug 转给它，工作台「我的工作」一进来就有内容 */
async function handOverWork(userId: string, position: string | null, projectIds: string[]) {
  const slot = position && ["product", "frontend", "backend", "qa"].includes(position) ? position : null;
  if (slot) {
    const rows = await prisma.requirementAssignee.findMany({
      where: { role: slot, requirement: { projectId: { in: projectIds }, deletedAt: null, status: { notIn: ["online", "cancelled"] } }, user: { demoKind: "persona" } },
      orderBy: { requirement: { plannedEndAt: "asc" } },
      take: 4,
      select: { id: true },
    });
    for (const r of rows) await prisma.requirementAssignee.update({ where: { id: r.id }, data: { userId } });
  }
  if (position && ["frontend", "backend", "qa", "tech_lead"].includes(position)) {
    const bugs = await prisma.bug.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null, status: { in: ["open", "in_progress", "reopened"] }, assignee: { demoKind: "persona", position: position === "qa" || position === "tech_lead" ? undefined : position } },
      orderBy: { dueAt: "asc" },
      take: 2,
      select: { id: true },
    });
    if (bugs.length) await prisma.bug.updateMany({ where: { id: { in: bugs.map((b) => b.id) } }, data: { assigneeId: userId } });
  }
}

/** 生成或重置：清空演示组织的数据，再按演示数据重建；体验账号保留并重新加入项目 */
export async function buildDemo(session: SessionUser) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const { orgId, depts } = await ensureOrg();
  await wipe(orgId);
  const who = await ensurePersonas(depts);
  const { counts } = await seed(orgId, who);
  await joinDemoProjects(orgId);
  await setSetting(DEMO_BUILT_KEY, new Date().toISOString());
  await prisma.activityLog.create({ data: { entityType: "organization", entityId: orgId, action: "demo_built", actorId: session.id, message: "生成演示组织数据" } });
  return { ok: true as const, orgId, counts };
}

/** 删除演示组织：数据、示例成员、体验账号、部门和企业本身 */
export async function deleteDemo(session: SessionUser) {
  if (session.globalRole !== ADMIN_ROLE) return deny();
  const orgId = await demoOrgId();
  if (!orgId) return { error: "还没有演示组织", status: 404 };
  await wipe(orgId);
  const userIds = await orgUserIds(orgId);
  await prisma.$transaction(
    async (tx) => {
      await tx.organization.updateMany({ where: { id: orgId }, data: { adminUserId: null } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.organization.deleteMany({ where: { parentId: orgId } });
      await tx.organization.delete({ where: { id: orgId } });
      await tx.systemSetting.deleteMany({ where: { key: { in: [DEMO_ORG_KEY, DEMO_BUILT_KEY, "demoOneClick"] } } });
    },
    { timeout: 60_000 },
  );
  await prisma.activityLog.create({ data: { entityType: "organization", entityId: orgId, action: "demo_deleted", actorId: session.id, message: "删除演示组织" } });
  return { ok: true as const };
}

/** 后台显示：演示组织是否存在、数据量、上次生成时间 */
export async function demoStatus() {
  const orgId = await demoOrgId();
  if (!orgId) return { exists: false as const };
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, code: true } });
  const built = await prisma.systemSetting.findUnique({ where: { key: DEMO_BUILT_KEY } });
  const projectIds = (await prisma.project.findMany({ where: { enterpriseId: orgId }, select: { id: true } })).map((p) => p.id);
  const productIds = (await prisma.product.findMany({ where: { enterpriseId: orgId }, select: { id: true } })).map((p) => p.id);
  const [personas, requirements, bugs, releases, docs] = await Promise.all([
    prisma.user.count({ where: { id: { in: await orgUserIds(orgId) }, demoKind: "persona" } }),
    prisma.requirement.count({ where: { deletedAt: null, OR: [{ projectId: { in: projectIds } }, { productId: { in: productIds } }] } }),
    prisma.bug.count({ where: { deletedAt: null, projectId: { in: projectIds } } }),
    prisma.release.count({ where: { projectId: { in: projectIds } } }),
    prisma.docPage.count({ where: { deletedAt: null, projectId: { in: projectIds } } }),
  ]);
  const realProjects = await prisma.project.count({ where: { id: { in: projectIds }, NOT: { status: "space" } } });
  return {
    exists: true as const,
    orgId,
    name: org?.name ?? DEMO_ORG_NAME,
    code: org?.code ?? null,
    builtAt: built?.value ?? null,
    counts: { personas, products: productIds.length, projects: realProjects, requirements, bugs, releases, docs },
  };
}

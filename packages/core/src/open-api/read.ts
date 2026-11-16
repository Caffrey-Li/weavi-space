import { prisma } from "@pm-collab/db/prisma";
import { bugWhere, inProjectsWhere, productWhere, projectWhere, requirementWhere, type Access } from "../access";

const project = { id: true, workspaceId: true, enterpriseId: true, name: true, key: true, systemName: true, iconUrl: true, coverUrl: true, description: true, status: true, plannedEndAt: true, actualEndAt: true, launchNotes: true, useCustomColumns: true, productId: true, createdById: true, createdAt: true, updatedAt: true, revision: true, prevStatus: true, archivedAt: true, archivedById: true, archivedVia: true, deletedAt: true, deletedById: true, deletedVia: true } as const;
const requirement = { id: true, title: true, summary: true, descriptionHtml: true, docUrl: true, projectId: true, parentId: true, productId: true, productNodeId: true, status: true, priority: true, creatorId: true, startAt: true, plannedEndAt: true, actualEndAt: true, tags: true, archivedAt: true, createdAt: true, updatedAt: true, revision: true } as const;
const bug = { id: true, title: true, summary: true, descriptionHtml: true, docUrl: true, projectId: true, requirementId: true, productId: true, productNodeId: true, environment: true, device: true, foundVersion: true, dueAt: true, status: true, severity: true, assigneeId: true, frontendId: true, backendId: true, creatorId: true, reopenCount: true, archivedAt: true, createdAt: true, updatedAt: true, revision: true } as const;
const release = { id: true, projectId: true, version: true, title: true, description: true, status: true, plannedAt: true, releasedAt: true, createdById: true, createdAt: true, updatedAt: true, revision: true, kind: true, reason: true } as const;
const product = { id: true, name: true, code: true, status: true, nodes: { select: { id: true, parentId: true, type: true, name: true, code: true, description: true, sortOrder: true } } } as const;
const page = { id: true, projectId: true, parentId: true, groupId: true, title: true, body: true, statusTag: true, version: true, creatorId: true, updatedById: true, publishedAt: true, createdAt: true, updatedAt: true, revision: true } as const;

export type Resource = "projects" | "requirements" | "bugs" | "releases" | "products" | "spaces";
export async function list(resource: Resource, access: Access, params: { page: number; pageSize: number; projectId: string | null; status: string | null }) {
  const { page: number, pageSize, projectId, status } = params;
  const paging = { skip: (number - 1) * pageSize, take: pageSize };
  const filter = { ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) };
  switch (resource) {
    case "projects": {
      const where = { status: { not: "space" }, AND: [projectWhere(access)] };
      const [items, total] = await Promise.all([prisma.project.findMany({ where, select: project, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...paging }), prisma.project.count({ where })]);
      return { items, total };
    }
    case "requirements": {
      const where = { archivedAt: null, ...filter, AND: [requirementWhere(access)] };
      const [items, total] = await Promise.all([prisma.requirement.findMany({ where, select: requirement, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], ...paging }), prisma.requirement.count({ where })]);
      return { items, total };
    }
    case "bugs": {
      const where = { archivedAt: null, ...filter, AND: [bugWhere(access)] };
      const [items, total] = await Promise.all([prisma.bug.findMany({ where, select: bug, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], ...paging }), prisma.bug.count({ where })]);
      return { items, total };
    }
    case "releases": {
      const where = { status: { not: "cancelled" }, AND: [inProjectsWhere(access)] };
      const [items, total] = await Promise.all([prisma.release.findMany({ where, select: release, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...paging }), prisma.release.count({ where })]);
      return { items, total };
    }
    case "products": {
      const where = { status: { not: "archived" }, AND: [productWhere(access)] };
      const [items, total] = await Promise.all([prisma.product.findMany({ where, select: product, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }], ...paging }), prisma.product.count({ where })]);
      return { items, total };
    }
    case "spaces": {
      const where = { status: { not: "archived" }, AND: [projectWhere(access)] };
      const [items, total] = await Promise.all([prisma.project.findMany({ where, select: { id: true, name: true, key: true, status: true, productId: true, description: true, iconUrl: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...paging }), prisma.project.count({ where })]);
      return { items, total };
    }
  }
}

export async function detail(resource: Resource | "pages", id: string, access: Access) {
  switch (resource) {
    case "projects": return prisma.project.findFirst({ where: { id, status: { not: "space" }, AND: [projectWhere(access)] }, select: project });
    case "requirements": return prisma.requirement.findFirst({ where: { id, AND: [requirementWhere(access)] }, select: requirement });
    case "bugs": return prisma.bug.findFirst({ where: { id, AND: [bugWhere(access)] }, select: bug });
    case "releases": return prisma.release.findFirst({ where: { id, AND: [inProjectsWhere(access)] }, select: release });
    case "products": return prisma.product.findFirst({ where: { id, AND: [productWhere(access)] }, select: product });
    case "pages": return prisma.docPage.findFirst({ where: { id, AND: [inProjectsWhere(access)] }, select: page });
    default: return null;
  }
}

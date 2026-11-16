import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createApiToken } from "@pm-collab/core/api-tokens";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || decodeURIComponent(url.username) !== "pm_test" || !/^\/pm_collab_t9_e2e_test_[a-f0-9]+$/.test(url.pathname)) throw new Error("仅允许本任务新建的隔离安全测试库");
const path = process.argv[2];
if (!path) throw new Error("缺少测试数据文件");

async function main() {
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "sec-manager@verify.test" } });
  const session = await prisma.session.create({ data: { userId: manager.id, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
  const actor = { id: manager.id, email: manager.email, name: manager.name, globalRole: manager.globalRole, sessionId: session.id };
  const full = await createApiToken(actor, { name: "v1-e2e", scopes: ["projects.read", "requirements.read", "requirements.create", "requirements.edit", "board.move", "bugs.read", "bugs.edit", "releases.read", "products.read", "docs.read"] });
  const limited = await createApiToken(actor, { name: "v1-limited-e2e", scopes: ["requirements.read"] });
  const product = await prisma.product.create({ data: { name: "V1 synthetic", code: "V1SYNTHETIC", enterpriseId: "sec_ent_a", ownerId: manager.id } });
  const release = await prisma.release.create({ data: { projectId: fx.b.projA, version: "9.9.91", createdById: manager.id } });
  const doc = await prisma.docPage.create({ data: { projectId: fx.b.projA, title: "V1 synthetic", body: `<p>synthetic <a class="doc-ref" data-ref-kind="req" data-ref-id="${fx.b.reqB}" href="/requirements/${fx.b.reqB}"><span class="doc-ref-code">REQ-X</span><span class="doc-ref-title">V1-CROSS-SNAPSHOT</span><span class="doc-ref-status">S</span></a></p>`, version: 1, creatorId: manager.id } });
  writeFileSync(path, JSON.stringify({ ...fx, v1: { full: full.token, limited: limited.token, managerId: manager.id, productId: product.id, releaseId: release.id, docId: doc.id } }), { mode: 0o600 });
  console.log("v1 安全测试令牌已在临时测试库创建");
}
main().finally(() => prisma.$disconnect());

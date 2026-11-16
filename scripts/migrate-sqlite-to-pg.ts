/**
 * SQLite → PostgreSQL 数据搬迁（11-06）。源库只读打开，绝不写；目标库必须是刚执行完迁移的空库。
 *
 * 用法（先备份并复制一份 dev.db，再对副本运行）：
 *   cp prisma/dev.db tmp/backups/dev-<日期>.db
 *   createdb pm_collab
 *   DATABASE_URL="postgresql://localhost:5432/pm_collab" npx prisma migrate deploy
 *   DATABASE_URL="postgresql://localhost:5432/pm_collab" npx tsx scripts/migrate-sqlite-to-pg.ts --source tmp/backups/dev-<日期>.db --dry-run
 *   DATABASE_URL="postgresql://localhost:5432/pm_collab" npx tsx scripts/migrate-sqlite-to-pg.ts --source tmp/backups/dev-<日期>.db --yes
 *
 * 参数：
 *   --source <路径>   SQLite 文件（不能直接指向 prisma/dev.db，先复制一份）
 *   --dry-run         全部写进一个事务后回滚，只看报告
 *   --yes             真正写入（不加时等同 --dry-run）
 *
 * 做的事：
 * - 按目标库（Prisma 迁移建好的表）的列逐表搬：源库有、目标库没有的表或列跳过并列出；目标库有、源库没有的列用默认值
 *   （例如 workspaceId = ws_default、revision = 0）。
 * - 类型转换：DateTime（SQLite 里有毫秒数和 "YYYY-MM-DD HH:MM:SS" 两种）按 UTC 写入；0/1 → 布尔；BLOB → bytea。
 * - 需求状态从中文名换成英文 key（requirements.status、需求状态变更动态的 fromValue / toValue、system_settings 里停用的阶段）。
 * - 旧库没有 bugs.reopenCount 时按动态回填（原来启动时做的事）。
 * - 外键指向不存在的记录（SQLite 时期没强制外键的表可能有）：可空列置空，必填列整行跳过，报告里列出。
 * - 整个搬迁在一个事务里：任何一步失败都回滚，目标库保持为空。最后逐表核对行数。
 */
import path from "node:path";
import fs from "node:fs";
import { Client } from "pg";
import { REQ_STATUS, normalizeReqStatus } from "../apps/web/src/lib/constants";
import { REQ_STAGES_SETTING_KEY } from "../apps/web/src/lib/req-stages-shared";
import { countBugReturns } from "../apps/web/src/lib/bug-return";

type Row = Record<string, unknown>;
type SqliteDb = { prepare(sql: string): { all(...args: unknown[]): Row[] }; close(): void };

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

const source = arg("--source");
const apply = flag("--yes") && !flag("--dry-run");
const targetUrl = process.env.DATABASE_URL || "";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!source) fail("缺少 --source <SQLite 文件>，用法见文件头");
const sourcePath = path.resolve(source);
if (!fs.existsSync(sourcePath)) fail(`找不到源库：${sourcePath}`);
if (/[/\\]prisma[/\\]dev\.db$/.test(sourcePath)) fail("不要直接对 prisma/dev.db 运行：先复制到 tmp/backups/ 再指向副本");
if (!/^postgres(ql)?:\/\//.test(targetUrl)) fail("DATABASE_URL 必须是 PostgreSQL 连接串（postgresql://…）");

const KEYS = new Set<string>(REQ_STATUS.map((s) => s.key));

// ———————— 类型转换 ————————

/** SQLite 里的时间 → UTC 的 "YYYY-MM-DD HH:MM:SS.mmm"（目标列是 timestamp(3) without time zone，Prisma 按 UTC 读写） */
function toTimestamp(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date;
  if (typeof v === "number" || typeof v === "bigint") d = new Date(Number(v));
  else {
    const s = String(v).trim();
    if (/^\d{10,}$/.test(s)) d = new Date(Number(s));
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) d = new Date(s.replace(" ", "T") + "Z"); // CURRENT_TIMESTAMP 是 UTC
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + "T00:00:00Z");
    else d = new Date(s);
  }
  if (Number.isNaN(d.getTime())) throw new Error(`无法识别的时间：${String(v)}`);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" || typeof v === "bigint") return Number(v) !== 0;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0" || s === "") return false;
  throw new Error(`无法识别的布尔值：${String(v)}`);
}

function convert(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type.startsWith("timestamp") || type === "date") return toTimestamp(v);
  if (type === "boolean") return toBool(v);
  if (type === "integer" || type === "bigint" || type === "smallint") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`无法识别的整数：${String(v)}`);
    return Math.trunc(n);
  }
  if (type === "double precision" || type === "numeric" || type === "real") return Number(v);
  if (type === "bytea") return Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(String(v));
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  return String(v);
}

// ———————— 需求状态 ————————

const statusStats = new Map<string, number>();
const unknownStatus = new Map<string, number>();
function mapReqStatus(raw: unknown): string {
  const from = String(raw ?? "");
  const to = normalizeReqStatus(from);
  if (!KEYS.has(to)) unknownStatus.set(from, (unknownStatus.get(from) || 0) + 1);
  if (from !== to) statusStats.set(`${from} → ${to}`, (statusStats.get(`${from} → ${to}`) || 0) + 1);
  return to;
}
/** 动态里的 {"status": "..."} */
function mapStatusJson(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.includes("status")) return raw;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o.status !== "string") return raw;
    return JSON.stringify({ ...o, status: normalizeReqStatus(o.status) });
  } catch {
    return raw;
  }
}

// ———————— 主流程 ————————

type Column = { name: string; type: string; nullable: boolean; hasDefault: boolean };
type ForeignKey = { column: string; refTable: string; refColumn: string };

async function main() {
  let DatabaseSync: new (file: string, opts: { readOnly: boolean }) => SqliteDb;
  try {
    const mod = "node:sqlite";
    ({ DatabaseSync } = (await import(mod)) as { DatabaseSync: typeof DatabaseSync });
  } catch {
    fail("需要 Node.js 22.5 以上（内置 node:sqlite）");
  }
  const src = new DatabaseSync(sourcePath, { readOnly: true });
  const pg = new Client({ connectionString: targetUrl });
  await pg.connect();
  // 本连接按 UTC 处理时间，和 Prisma 一致
  await pg.query("SET TIME ZONE 'UTC'");

  const report: string[] = [];
  try {
    // 目标库：Prisma 迁移建好的表
    const tables = (
      await pg.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
      )
    ).rows.map((r) => r.table_name);
    if (!tables.includes("workspaces")) fail("目标库还没执行迁移：先运行 npx prisma migrate deploy");

    const columns = new Map<string, Column[]>();
    for (const r of (
      await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY ordinal_position`,
      )
    ).rows) {
      if (!tables.includes(r.table_name)) continue;
      const list = columns.get(r.table_name) || [];
      list.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES", hasDefault: r.column_default !== null });
      columns.set(r.table_name, list);
    }
    const fks = new Map<string, ForeignKey[]>();
    for (const r of (
      await pg.query<{ table_name: string; column_name: string; ref_table: string; ref_column: string }>(
        `SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`,
      )
    ).rows) {
      const list = fks.get(r.table_name) || [];
      list.push({ column: r.column_name, refTable: r.ref_table, refColumn: r.ref_column });
      fks.set(r.table_name, list);
    }

    // 目标库必须为空（迁移自带的默认工作区除外）
    for (const t of tables) {
      const n = Number((await pg.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
      const allowed = t === "workspaces" ? 1 : 0;
      if (n > allowed) fail(`目标库不是空库：${t} 已有 ${n} 行。请换一个刚执行完迁移的新库`);
    }

    // 外键依赖排序（自引用另外处理）
    const order: string[] = [];
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const visit = (t: string) => {
      if (seen.has(t)) return;
      if (visiting.has(t)) throw new Error(`表之间有循环外键：${t}`);
      visiting.add(t);
      // organizations.adminUserId → users 与 users.orgId → organizations 互相引用：排序时忽略前者。
      // SQLite 时期没有这一列（企业超管 11-12 才加），导入后为空，由系统超管在 Nova 后台重新指定
      for (const fk of fks.get(t) || []) if (fk.refTable !== t && !(t === "organizations" && fk.column === "adminUserId")) visit(fk.refTable);
      visiting.delete(t);
      seen.add(t);
      order.push(t);
    };
    for (const t of tables) visit(t);

    const srcTables = new Set(src.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => String(r.name)));
    const onlyInSource = Array.from(srcTables).filter((t) => !tables.includes(t) && t !== "_prisma_migrations");
    if (onlyInSource.length) report.push(`源库里有、目标库没有的表（跳过）：${onlyInSource.join("、")}`);

    // 已写入的主键：外键校验用
    const ids = new Map<string, Set<string>>();
    // 动态：bugs.reopenCount 回填要用
    const bugLogs: { entityId: string; fromValue: string | null; toValue: string | null }[] = [];
    if (srcTables.has("activity_logs")) {
      for (const r of src.prepare(`SELECT "entityId", "fromValue", "toValue" FROM "activity_logs" WHERE "entityType" = 'bug' AND "action" = 'status_changed'`).all()) {
        bugLogs.push({ entityId: String(r.entityId), fromValue: (r.fromValue as string) ?? null, toValue: (r.toValue as string) ?? null });
      }
    }

    await pg.query("BEGIN");
    const counts: [string, number, number][] = [];
    for (const t of order) {
      if (t === "workspaces") {
        ids.set(t, new Set((await pg.query(`SELECT id FROM "workspaces"`)).rows.map((r) => String(r.id))));
        continue;
      }
      if (!srcTables.has(t)) {
        report.push(`目标库的表 ${t} 在源库里没有，保持为空`);
        counts.push([t, 0, 0]);
        continue;
      }
      const cols = columns.get(t) || [];
      const srcCols = new Set(src.prepare(`PRAGMA table_info("${t}")`).all().map((r) => String(r.name)));
      const dropped = Array.from(srcCols).filter((c) => !cols.some((x) => x.name === c));
      if (dropped.length) report.push(`${t}：源库多出的列不搬：${dropped.join("、")}`);
      const missing = cols.filter((c) => !srcCols.has(c.name));
      const lacking = missing.filter((c) => !c.nullable && !c.hasDefault && !(t === "bugs" && c.name === "reopenCount"));
      if (lacking.length) throw new Error(`${t}：源库缺少必填列 ${lacking.map((c) => c.name).join("、")}，目标库也没有默认值`);
      const use = cols.filter((c) => srcCols.has(c.name) || (t === "bugs" && c.name === "reopenCount"));
      const tableFks = fks.get(t) || [];

      let rows = src.prepare(`SELECT * FROM "${t}"`).all();
      const total = rows.length;
      // 自引用（组织树、需求父子、产品功能树、文档页面树）：父节点先写
      const self = tableFks.filter((fk) => fk.refTable === t);
      if (self.length && rows.length) {
        const all = new Set(rows.map((r) => String(r.id)));
        const byId = new Map(rows.map((r) => [String(r.id), r]));
        const depth = new Map<string, number>();
        const depthOf = (r: Row, guard = 0): number => {
          const id = String(r.id);
          if (depth.has(id)) return depth.get(id)!;
          let d = 0;
          for (const fk of self) {
            const p = r[fk.column];
            if (p && all.has(String(p)) && guard < 1000) d = Math.max(d, depthOf(byId.get(String(p))!, guard + 1) + 1);
          }
          depth.set(id, d);
          return d;
        };
        rows = [...rows].sort((a, b) => depthOf(a) - depthOf(b));
      }

      const own = new Set<string>();
      ids.set(t, own);
      const ready: unknown[][] = [];
      let skipped = 0;
      const nulled = new Map<string, number>();
      for (const r of rows) {
        const out: Row = { ...r };
        if (t === "requirements") out.status = mapReqStatus(r.status);
        if (t === "activity_logs" && r.entityType === "requirement") {
          out.fromValue = mapStatusJson(r.fromValue);
          out.toValue = mapStatusJson(r.toValue);
        }
        if (t === "system_settings" && r.key === REQ_STAGES_SETTING_KEY) {
          try {
            out.value = JSON.stringify((JSON.parse(String(r.value || "[]")) as string[]).map((s) => normalizeReqStatus(String(s))));
          } catch {
            /* 解析不了就原样搬 */
          }
        }
        if (t === "bugs" && !srcCols.has("reopenCount")) out.reopenCount = 0;
        // 外键校验
        let drop = false;
        for (const fk of tableFks) {
          const v = out[fk.column];
          if (v === null || v === undefined || v === "") continue;
          const refIds = fk.refTable === t ? own : ids.get(fk.refTable);
          if (refIds?.has(String(v))) continue;
          const col = cols.find((c) => c.name === fk.column)!;
          if (col.nullable) {
            out[fk.column] = null;
            nulled.set(fk.column, (nulled.get(fk.column) || 0) + 1);
          } else drop = true;
        }
        if (drop) {
          skipped++;
          continue;
        }
        if (out.id !== undefined) own.add(String(out.id));
        ready.push(use.map((c) => convert(out[c.name], c.type)));
      }
      if (t === "bugs" && !srcCols.has("reopenCount")) {
        const n = countBugReturns(bugLogs);
        const at = use.findIndex((c) => c.name === "reopenCount");
        const idAt = use.findIndex((c) => c.name === "id");
        for (const r of ready) r[at] = n.get(String(r[idAt])) || 0;
        report.push(`bugs：源库没有 reopenCount，已按动态回填 ${n.size} 条`);
      }
      if (skipped) report.push(`${t}：${skipped} 行的必填外键指向不存在的记录，跳过`);
      for (const [c, n] of nulled) report.push(`${t}.${c}：${n} 行指向不存在的记录，已置空`);

      // 分批写入：参数不超过 PostgreSQL 的 65535 个，二进制大的表每批少一点
      const per = Math.max(1, Math.min(500, Math.floor(60000 / Math.max(1, use.length))));
      const batch = use.some((c) => c.type === "bytea") ? Math.min(per, 20) : per;
      const colSql = use.map((c) => `"${c.name}"`).join(", ");
      for (let i = 0; i < ready.length; i += batch) {
        const chunk = ready.slice(i, i + batch);
        const values = chunk.map((_, ri) => `(${use.map((__, ci) => `$${ri * use.length + ci + 1}`).join(", ")})`).join(", ");
        await pg.query(`INSERT INTO "${t}" (${colSql}) VALUES ${values}`, chunk.flat());
      }
      const written = Number((await pg.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
      if (written !== ready.length) throw new Error(`${t}：应写入 ${ready.length} 行，实际 ${written} 行`);
      counts.push([t, total, written]);
    }

    console.log(`源库：${sourcePath}`);
    console.log(`目标：${new URL(targetUrl).host}${new URL(targetUrl).pathname}`);
    console.log("\n表                         源库行数   写入行数");
    for (const [t, a, b] of counts) console.log(`${t.padEnd(26)} ${String(a).padStart(8)} ${String(b).padStart(10)}${a !== b ? "  ←" : ""}`);
    if (statusStats.size) {
      console.log("\n需求状态：");
      for (const [k, n] of statusStats) console.log(`  ${k}：${n}`);
    }
    if (unknownStatus.size) report.push(`认不出的需求状态（原样保留，请人工处理）：${Array.from(unknownStatus).map(([k, n]) => `「${k}」${n} 条`).join("、")}`);
    if (report.length) {
      console.log("\n说明：");
      for (const r of report) console.log(`  - ${r}`);
    }
    if (apply) {
      await pg.query("COMMIT");
      console.log("\n✓ 已写入。下一步：用这个 DATABASE_URL 启动服务，抽查几个页面。");
    } else {
      await pg.query("ROLLBACK");
      console.log("\n（预演：已回滚，目标库没有变化。确认无误后加 --yes 正式写入）");
    }
  } catch (e) {
    await pg.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    src.close();
    await pg.end();
  }
}

main().catch((e) => {
  console.error("✗ 搬迁失败，目标库已回滚：", e instanceof Error ? e.message : e);
  process.exit(1);
});

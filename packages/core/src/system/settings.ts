import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { sanitizeSvg } from "../shared/svg-sanitize";
import { sniffImage } from "../shared/upload-guard";
import { TIMEZONES, getSystemSettings, saveSystemSettings, type SystemSettings } from "../shared/system-settings";

const LOGO_MAX = 200 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function GET(_session: SessionUser) {
  void _session;
  return result({ settings: await getSystemSettings() });
}

/** 更新系统设置：字段与 logo 全部校验完后才检查管理员 */
export async function PUT(session: SessionUser, body: Record<string, unknown>) {
  const patch: Partial<SystemSettings> = {};
  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (!name) return result({ error: "请填写系统名称" }, { status: 400 });
    if (name.length > 30) return result({ error: "系统名称最多 30 个字" }, { status: 400 });
    patch.name = name;
  }
  if ("timezone" in body) {
    const tz = String(body.timezone || "");
    if (!TIMEZONES.some((t) => t.value === tz)) return result({ error: "不支持的时区" }, { status: 400 });
    patch.timezone = tz;
  }
  if ("weekStart" in body) {
    const w = String(body.weekStart);
    if (w !== "0" && w !== "1") return result({ error: "每周起始日只能是周一或周日" }, { status: 400 });
    patch.weekStart = w;
  }
  if ("logo" in body) {
    let logo = String(body.logo || "");
    if (logo) {
      const m = logo.match(/^data:([a-z/+]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || !LOGO_TYPES.includes(m[1])) return result({ error: "标志只支持 PNG、JPG、WebP 或 SVG" }, { status: 400 });
      if (Math.floor((m[2].length * 3) / 4) > LOGO_MAX) return result({ error: "标志图片不能超过 200KB" }, { status: 400 });
      // SVG 可能带脚本：白名单清洗后再存；其余格式按内容核对类型
      if (m[1] === "image/svg+xml") {
        const svg = sanitizeSvg(Buffer.from(m[2], "base64").toString("utf8"));
        if (!svg) return result({ error: "SVG 标志里不能包含外部引用" }, { status: 400 });
        logo = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
      } else if (sniffImage(Buffer.from(m[2], "base64"))?.mime !== m[1]) {
        return result({ error: "标志只支持 PNG、JPG、WebP 或 SVG" }, { status: 400 });
      }
    }
    patch.logo = logo;
  }
  if (!Object.keys(patch).length) return result({ error: "没有需要更新的内容" }, { status: 400 });
  if (session.globalRole !== "admin") {
    return result({ error: "只有系统管理员可以修改系统设置" }, { status: 403 });
  }
  const before = await getSystemSettings();
  await saveSystemSettings(patch);
  await prisma.activityLog
    .create({
      data: {
        entityType: "system",
        entityId: "settings",
        action: "updated",
        actorId: session.id,
        fromValue: JSON.stringify({ ...before, logo: before.logo ? "(图片)" : "" }),
        toValue: JSON.stringify({ ...patch, ...(patch.logo !== undefined ? { logo: patch.logo ? "(图片)" : "" } : {}) }),
      },
    })
    .catch(() => undefined);
  return result({ ok: true });
}

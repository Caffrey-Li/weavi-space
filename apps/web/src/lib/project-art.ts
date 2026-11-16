import { prisma } from "./prisma";
import { imageConfig, type ImageConfig } from "@pm-collab/core/ai/image";
import { recordUsage } from "@pm-collab/core/ai/quota";
import { removeUploadByUrl, removeUploadsFor, writeUpload } from "./upload-store";
import { coverSvg, iconSvg } from "./project-art-shared";

/**
 * 项目配图：内置生成（SVG，免费、即时）+ AI 生成（OpenAI 兼容的图片接口，需管理员在「系统 › AI 生图」配置）。
 * 背景图存 project_covers（和上传的一样），图标存 uploads/projects/<id>.<ext>。
 */
export class ArtError extends Error {}

async function saveCover(projectId: string, mime: string, data: Buffer) {
  const coverUrl = `/api/projects/${projectId}/cover?v=${Date.now()}`;
  await prisma.$transaction([
    prisma.projectCover.upsert({ where: { projectId }, create: { projectId, mime, data }, update: { mime, data } }),
    prisma.project.update({ where: { id: projectId }, data: { coverUrl } }),
  ]);
  return coverUrl;
}

async function saveIcon(projectId: string, ext: string, data: Buffer) {
  const filename = `${projectId}.${ext}`;
  await writeUpload("projects", filename, data);
  await removeUploadsFor("projects", projectId, filename);
  const old = await prisma.project.findUnique({ where: { id: projectId }, select: { iconUrl: true } });
  if (old?.iconUrl && !old.iconUrl.includes(`/${filename}`)) await removeUploadByUrl("projects", old.iconUrl);
  const iconUrl = `/uploads/projects/${filename}?t=${Date.now()}`;
  await prisma.project.update({ where: { id: projectId }, data: { iconUrl } });
  return iconUrl;
}

/** 内置生成：seed 不传时按项目名固定（新建项目、补图用），「换一张」传随机数 */
export async function applyPatternArt(projectId: string, opts: { cover?: boolean; icon?: boolean; style?: string; seed?: number } = {}) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!p) throw new ArtError("项目不存在");
  const seed = opts.seed ?? 0;
  const out: { coverUrl?: string; iconUrl?: string; style?: string } = {};
  if (opts.cover !== false) {
    const c = coverSvg(p.name, seed, opts.style);
    out.style = c.style;
    out.coverUrl = await saveCover(projectId, "image/svg+xml", Buffer.from(c.svg, "utf8"));
  }
  if (opts.icon) {
    const i = iconSvg(p.name, seed, opts.style);
    out.style ||= i.style;
    out.iconUrl = await saveIcon(projectId, "svg", Buffer.from(i.svg, "utf8"));
  }
  return out;
}

function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { mime: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** 调用 OpenAI 兼容的 /images/generations；部分服务不认 response_format / watermark，失败时去掉再试一次 */
export async function generateAiImage(cfg: ImageConfig | null, prompt: string, size: string): Promise<{ data: Buffer; mime: string; ext: string }> {
  if (!cfg) throw new ArtError("本企业还没有配置 AI 生图：请企业超管在「设置 › AI 生图」填写接口地址、模型和 API Key");
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/images/generations`;
  const call = async (extra: boolean) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, prompt, size, n: 1, ...(extra ? { response_format: "b64_json", watermark: false } : {}) }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    const d = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string; code?: string } | string };
    return { ok: res.ok, status: res.status, d };
  };
  let r = await call(true);
  if (!r.ok && r.status === 400 && /response_format|watermark|unknown|unrecognized|parameter/i.test(JSON.stringify(r.d.error || ""))) r = await call(false);
  if (!r.ok) {
    const e = r.d.error;
    const msg = typeof e === "string" ? e : e?.message || `HTTP ${r.status}`;
    if (r.status === 401 || r.status === 403) throw new ArtError(`AI 生图接口拒绝访问，请检查 API Key 和模型开通情况：${msg}`);
    throw new ArtError(`AI 生图失败：${msg}`);
  }
  const item = r.d.data?.[0];
  let buf: Buffer | null = null;
  if (item?.b64_json) buf = Buffer.from(item.b64_json, "base64");
  else if (item?.url && item.url.startsWith("https://")) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (img.ok) buf = Buffer.from(await img.arrayBuffer());
  }
  if (!buf || buf.length < 100) throw new ArtError("AI 生图接口没有返回图片");
  if (buf.length > 10 * 1024 * 1024) throw new ArtError("生成的图片超过 10MB，请在配置里改小尺寸");
  const type = sniff(buf);
  if (!type) throw new ArtError("AI 生图接口返回的不是 PNG / JPEG / WebP 图片");
  return { data: buf, ...type };
}

/** 用项目所属企业的配置生成（企业之间不共用 Key），生成成功按单价记一条用量 */
export async function applyAiArt(projectId: string, target: "cover" | "icon", userId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, systemName: true, description: true, enterpriseId: true } });
  if (!p) throw new ArtError("项目不存在");
  const cfg = await imageConfig(p.enterpriseId || "");
  const bill = () => recordUsage({ userId, enterpriseId: p.enterpriseId || null, billedTo: "enterprise", provider: "image", model: cfg!.model, feature: "image", images: 1, costCents: cfg!.priceCents });
  const about = [p.systemName && p.systemName !== p.name ? `所属系统「${p.systemName}」` : "", p.description ? `项目简介：${p.description.slice(0, 200)}` : ""].filter(Boolean).join("；");
  if (target === "cover") {
    const prompt = `为软件研发项目「${p.name}」设计一张横幅背景插画。${about ? `${about}。` : ""}要求：现代扁平风格的抽象概念插画，配色柔和协调，横向构图，主体偏右、左侧留出干净的空间，画面中不要出现任何文字、字母、数字或标志。`;
    const img = await generateAiImage(cfg, prompt, cfg?.size || "2048x512");
    await bill();
    return { coverUrl: await saveCover(projectId, img.mime, img.data) };
  }
  const prompt = `为软件研发项目「${p.name}」设计一个应用图标。${about ? `${about}。` : ""}要求：一个简洁、有辨识度的象征图形居中，渐变或纯色背景铺满整个正方形画面，扁平风格，不要任何文字或字母，不要圆角边框。`;
  const img = await generateAiImage(cfg, prompt, "1024x1024");
  await bill();
  return { iconUrl: await saveIcon(projectId, img.ext, img.data) };
}

/** 一次性：给还没有背景图 / 图标的项目补上内置配图（system_settings.projectArtBackfill 记录已执行） */
export async function backfillProjectArt() {
  if (await prisma.systemSetting.findUnique({ where: { key: "projectArtBackfill" }, select: { key: true } })) return 0;
  const list = await prisma.project.findMany({ where: { status: { not: "space" }, OR: [{ coverUrl: null }, { iconUrl: null }] }, select: { id: true, coverUrl: true, iconUrl: true } });
  for (const p of list) {
    try {
      await applyPatternArt(p.id, { cover: !p.coverUrl, icon: !p.iconUrl });
    } catch (e) {
      console.error("[配图] 补图失败", p.id, e);
    }
  }
  await prisma.systemSetting.createMany({ data: [{ key: "projectArtBackfill", value: new Date().toISOString() }], skipDuplicates: true });
  return list.length;
}

/**
 * 一次性：把自动生成的默认背景图（SVG）换成新的默认风格「辉光」（system_settings.projectArtGlow 记录已执行）。
 * 上传的、AI 生成的背景图不动；图标不动。
 */
export async function refreshDefaultCovers() {
  if (await prisma.systemSetting.findUnique({ where: { key: "projectArtGlow" }, select: { key: true } })) return 0;
  const covers = await prisma.projectCover.findMany({ where: { mime: "image/svg+xml" }, select: { projectId: true } });
  let n = 0;
  for (const c of covers) {
    try {
      await applyPatternArt(c.projectId, { cover: true, icon: false, style: "glow" });
      n++;
    } catch (e) {
      console.error("[配图] 默认背景图换新失败", c.projectId, e);
    }
  }
  await prisma.systemSetting.createMany({ data: [{ key: "projectArtGlow", value: new Date().toISOString() }], skipDuplicates: true });
  return n;
}

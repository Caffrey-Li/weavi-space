import { z } from "zod";
import { prisma } from "@pm-collab/db/prisma";
import { ARCH_IMAGE_TYPES, ARCH_TYPES, archImageProblem } from "../shared/product-arch";
import { sanitizeSvg } from "../shared/svg-sanitize";
import { cleanFileName, sniffImage } from "../shared/upload-guard";

const Fields = z.object({
  type: z.enum(ARCH_TYPES.map((t) => t.key) as [string, ...string[]], { message: "架构图类型无效" }).optional(),
  name: z.string().trim().max(60, "名称不能超过 60 字").optional(),
  description: z.string().trim().max(2000, "说明不能超过 2000 字").nullable().optional(),
});

/** 读架构图表单（multipart）：没传的字段不出现在 fields 里，file 经类型、大小校验 */
export async function readArchForm(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return { error: "表单无效" };
  const text = (k: string) => (form.has(k) ? String(form.get(k)) : undefined);
  const description = text("description");
  const parsed = Fields.safeParse({ type: text("type"), name: text("name"), description: description === undefined ? undefined : description || null });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "表单无效" };
  const raw = form.get("file");
  const file = raw && typeof raw !== "string" && raw.size ? raw : null;
  const problem = file ? archImageProblem(file) : "";
  if (problem) return { error: problem };
  const image = file ? await readArchImage(file) : null;
  if (image && "error" in image) return { error: image.error };
  // undefined 的键不写库
  const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as z.infer<typeof Fields>;
  return { fields, file: file && image ? { name: file.name, ...image } : null };
}

type ArchImage = { data: Buffer; mime: string };

/** 按内容判断真实类型；SVG 白名单清洗后再存 */
async function readArchImage(file: File): Promise<ArchImage | { error: string }> {
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffImage(data);
  if (type) return ARCH_IMAGE_TYPES.includes(type.mime) ? { data, mime: type.mime } : { error: "仅支持 PNG / JPG / SVG / WebP 图片" };
  const svg = sanitizeSvg(data.toString("utf8"));
  if (!svg) return { error: "文件内容不是有效的图片，或 SVG 里含外部引用" };
  return { data: Buffer.from(svg, "utf8"), mime: "image/svg+xml" };
}

/** 图片字节存 attachments，地址 /api/attachments/<id> */
export async function storeArchImage(archId: string, file: ArchImage & { name: string }, uploaderId: string) {
  const att = await prisma.attachment.create({
    data: {
      ownerType: "product_arch",
      ownerId: archId,
      name: cleanFileName(file.name, "架构图"),
      mime: file.mime,
      size: file.data.length,
      data: file.data,
      uploaderId,
    },
    select: { id: true },
  });
  return att.id;
}

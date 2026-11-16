import { randomUUID } from "crypto";
import { storage } from "./storage";

// 上传文件（头像、项目图标）的存放位置，默认本地盘。
export type UploadDir = "avatars" | "projects";

const EXTS = ["jpg", "jpeg", "png", "webp", "gif"];

export async function writeUpload(dir: UploadDir, filename: string, buf: Buffer) {
  await storage().write("uploads", `${dir}/${filename}`, buf);
}

export async function readUpload(dir: UploadDir, filename: string): Promise<Buffer | null> {
  return storage().read("uploads", `${dir}/${filename}`);
}

/** 新上传文件的名字：随机 id，不用用户 id（地址不可猜） */
export function randomUploadName(ext: string) {
  return `${randomUUID().replace(/-/g, "")}.${ext}`;
}

/** 删除地址（/uploads/<dir>/<文件名>?t=…）对应的旧文件 */
export async function removeUploadByUrl(dir: UploadDir, url: string | null | undefined) {
  const name = /^\/uploads\/[a-z]+\/([a-zA-Z0-9_-]+\.[a-z]+)/.exec(url || "")?.[1];
  if (!name) return;
  await storage().delete("uploads", `${dir}/${name}`).catch(() => undefined);
}

/** 删除 `<id>.<ext>` 形式的旧文件，keep 为要保留的文件名 */
export async function removeUploadsFor(dir: UploadDir, id: string, keep?: string) {
  const names = EXTS.map((ext) => `${id}.${ext}`).filter((f) => f !== keep);
  await Promise.all(names.map((f) => storage().delete("uploads", `${dir}/${f}`).catch(() => undefined)));
}

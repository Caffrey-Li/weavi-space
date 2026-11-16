import { promises as fs } from "fs";
import path from "path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type Area = "uploads" | "config";

type Storage = {
  read(area: Area, key: string): Promise<Buffer | null>;
  write(area: Area, key: string, data: Buffer): Promise<void>;
  delete(area: Area, key: string): Promise<void>;
};

function localPath(area: Area, key: string) {
  if (area === "config") {
    if (key !== "secure-config") throw new Error("无效的配置存储键");
    return path.join(process.cwd(), ".data", "secure-config.json");
  }
  if (!/^(avatars|projects)\/[a-zA-Z0-9_-]+\.[a-z]+$/.test(key)) throw new Error("无效的上传存储键");
  return path.join(process.cwd(), "public", "uploads", key);
}

const local: Storage = {
  async read(area, key) {
    const file = localPath(area, key);
    try { return await fs.readFile(file); } catch { return null; }
  },
  async write(area, key, data) {
    const file = localPath(area, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, area === "config" ? { mode: 0o600 } : undefined);
  },
  async delete(area, key) {
    await fs.unlink(localPath(area, key));
  },
};

function s3Storage(): Storage {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("使用 S3 存储时必须设置 S3_BUCKET");
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === undefined ? Boolean(endpoint) : process.env.S3_FORCE_PATH_STYLE === "true",
    // 阿里云 OSS、MinIO 等 S3 兼容存储不认新版 SDK 默认附带的 CRC 校验头，只在接口要求时才算
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const objectKey = (area: Area, key: string) => {
    localPath(area, key);
    return `${area}/${key}`;
  };
  return {
    async read(area, key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(area, key) }));
        if (!response.Body) throw new Error("S3 对象没有内容流");
        return Buffer.from(await response.Body.transformToByteArray());
      } catch (e) {
        if (e && typeof e === "object" && "name" in e && (e.name === "NoSuchKey" || (e.name === "NotFound" && "$metadata" in e && (e.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404))) return null;
        throw e;
      }
    },
    async write(area, key, data) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(area, key), Body: data }));
    },
    async delete(area, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(area, key) }));
    },
  };
}

let s3: Storage | undefined;
export function storage(): Storage {
  const backend = process.env.UPLOAD_STORE || "local";
  if (backend === "local") return local;
  if (backend === "s3") return s3 ??= s3Storage();
  throw new Error(`不支持的 UPLOAD_STORE：${backend}；Netlify Blobs 数据需要先迁移`);
}

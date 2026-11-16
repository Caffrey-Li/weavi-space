import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const mocks = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock("fs", () => ({ promises: { mkdir: mocks.mkdir, readFile: mocks.readFile, writeFile: mocks.writeFile, unlink: mocks.unlink } }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { constructor(config: unknown) { mocks.client(config); } send = mocks.send; },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
}));

import { storage } from "@pm-collab/core/shared/storage";
import { readUpload, removeUploadByUrl, removeUploadsFor, writeUpload } from "@/lib/upload-store";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPLOAD_STORE", "");
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("S3_REGION", "test-region-1");
  vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9000");
  vi.stubEnv("S3_FORCE_PATH_STYLE", "true");
});

describe("本地存储（默认）", () => {
  it("继续使用原来的上传路径，读写和删除沿用原接口", async () => {
    const data = Buffer.from("image");
    mocks.readFile.mockResolvedValueOnce(data);
    await writeUpload("avatars", "a.png", data);
    expect(mocks.writeFile).toHaveBeenCalledWith(path.join(process.cwd(), "public/uploads/avatars/a.png"), data, undefined);
    expect(await readUpload("avatars", "a.png")).toEqual(data);
    await removeUploadByUrl("avatars", "/uploads/avatars/a.png?t=1");
    expect(mocks.unlink).toHaveBeenCalledWith(path.join(process.cwd(), "public/uploads/avatars/a.png"));
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("原有加密配置路径保持私有文件权限", async () => {
    const data = Buffer.from("encrypted");
    await storage().write("config", "secure-config", data);
    expect(mocks.writeFile).toHaveBeenCalledWith(path.join(process.cwd(), ".data/secure-config.json"), data, { mode: 0o600 });
  });
  it("缺失文件返回 null，旧文件清理保留指定文件", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("missing"));
    expect(await readUpload("projects", "old.png")).toBeNull();
    await removeUploadsFor("projects", "id", "id.png");
    expect(mocks.unlink).toHaveBeenCalledTimes(4);
    expect(mocks.unlink).not.toHaveBeenCalledWith(path.join(process.cwd(), "public/uploads/projects/id.png"));
  });
  it("拒绝越界存储键", async () => {
    await expect(storage().write("uploads", "avatars/../../x.png", Buffer.from("x"))).rejects.toThrow();
    await expect(storage().read("config", "../x")).rejects.toThrow();
  });
});

describe("S3 存储（模拟客户端）", () => {
  it("通过相同接口读写删除对象，并把私有配置放在独立前缀", async () => {
    vi.stubEnv("UPLOAD_STORE", "s3");
    mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Body: { transformToByteArray: async () => Uint8Array.from([1, 2]) } }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const data = Buffer.from([1, 2]);
    await writeUpload("projects", "p.png", data);
    expect(await readUpload("projects", "p.png")).toEqual(data);
    await removeUploadByUrl("projects", "/uploads/projects/p.png");
    await storage().write("config", "secure-config", Buffer.from("encrypted"));
    expect(mocks.client).toHaveBeenCalledWith({ region: "test-region-1", endpoint: "http://127.0.0.1:9000", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
    expect(mocks.send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: "test-bucket", Key: "uploads/projects/p.png", Body: data },
      { Bucket: "test-bucket", Key: "uploads/projects/p.png" },
      { Bucket: "test-bucket", Key: "uploads/projects/p.png" },
      { Bucket: "test-bucket", Key: "config/secure-config", Body: Buffer.from("encrypted") },
    ]);
  });
  it("缺失对象返回 null，权限和存储桶错误不能伪装成缺失对象", async () => {
    vi.stubEnv("UPLOAD_STORE", "s3");
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("bucket missing"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }));
    expect(await readUpload("avatars", "a.png")).toBeNull();
    await expect(readUpload("avatars", "a.png")).rejects.toThrow("denied");
    await expect(readUpload("avatars", "a.png")).rejects.toThrow("bucket missing");
  });
  it("没有配置存储桶时拒绝启动 S3 存储", async () => {
    vi.resetModules();
    vi.stubEnv("UPLOAD_STORE", "s3");
    vi.stubEnv("S3_BUCKET", "");
    const fresh = await import("@pm-collab/core/shared/storage");
    expect(() => fresh.storage()).toThrow(/S3_BUCKET/);
  });
  it("旧 Blobs 配置不静默切换到空的本地存储", () => {
    vi.stubEnv("UPLOAD_STORE", "blobs");
    expect(() => storage()).toThrow(/迁移/);
  });
});

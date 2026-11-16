import { expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@pm-collab/core/shared/storage", () => ({ storage: () => storage }));
vi.mock("@pm-collab/core/shared/auth-secret", () => ({ authSecretString: () => "unit-test-only-encryption-input-not-a-real-key" }));
import { saveFeishu } from "@pm-collab/core/shared/secure-config";

it("敏感配置始终先加密再交给存储接口", async () => {
  vi.stubEnv("ENCRYPTION_KEY", "");
  storage.read.mockResolvedValue(null);
  await saveFeishu({ appId: "test-app", appSecret: "synthetic-secret" }, "tester");
  expect(storage.write).toHaveBeenCalledTimes(1);
  const [area, key, body] = storage.write.mock.calls[0];
  expect([area, key]).toEqual(["config", "secure-config"]);
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(body.toString()).not.toContain("synthetic-secret");
  expect(JSON.parse(body.toString())).toMatchObject({ v: 2 });
  vi.unstubAllEnvs();
});

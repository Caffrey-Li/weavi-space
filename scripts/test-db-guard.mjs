/**
 * 测试脚本的数据库保护：只允许连「库名里有 test / verify / e2e / smoke」的 PostgreSQL 库，
 * 防止端到端测试、种子脚本误写正式库。被 security-e2e、tests/e2e、迁移脚本的 --target 检查共用。
 */
export function testDatabaseName(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return null;
    return decodeURIComponent(u.pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

export function isTestDatabaseUrl(url) {
  const name = testDatabaseName(url || "");
  return Boolean(name && /(test|verify|e2e|smoke)/i.test(name));
}

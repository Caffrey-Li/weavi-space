/** 读权限只表示可读取用户原本可见的数据；写权限对应现有功能点。 */
export const READ_SCOPES = ["projects.read", "requirements.read", "bugs.read", "releases.read", "products.read", "docs.read"] as const;
/** 只列 /api/v1 实际用到的写入功能点；新开放写接口时再加，未使用的 scope 不允许签发。 */
export const WRITE_SCOPES = ["requirements.create", "requirements.edit", "board.move", "bugs.edit", "docs.edit"] as const;
export const API_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
export function isReadScope(value: string) {
  return (READ_SCOPES as readonly string[]).includes(value);
}

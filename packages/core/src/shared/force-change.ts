/** 必须先改密的账号，改完之前只能访问这些地址（中间件、服务端共用，不能引入 prisma） */
const API_ALLOWED = ["/api/auth/change-password", "/api/auth/avatar", "/api/auth/logout"];

export function allowedWhileForcedChange(pathname: string) {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;
  return API_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

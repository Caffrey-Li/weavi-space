import type { SessionUser } from "../auth";
import { getSystemSettings } from "../shared/system-settings";

/** 系统 · 常规页：设置内容与是否可编辑（访问地址由页面读 headers） */
export async function loadGeneralPage(session: SessionUser | null) {
  const settings = await getSystemSettings();
  const canEdit = session?.globalRole === "admin";
  return { settings, canEdit };
}

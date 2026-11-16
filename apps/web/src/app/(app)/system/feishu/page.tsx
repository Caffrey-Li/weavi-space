import { redirect } from "next/navigation";

/** 旧的「飞书登录」已并入「登录管理」 */
export default function FeishuSettingsPage() {
  redirect("/system/login");
}

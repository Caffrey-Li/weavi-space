import { redirect } from "next/navigation";

/** ITR 同步已并入「飞书表格同步」：把 ITR 表格作为一个连接配置即可 */
export default function ItrSettingsPage() {
  redirect("/system/feishu-tables");
}

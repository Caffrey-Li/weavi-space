import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@pm-collab/core/auth";
import { needsSetup } from "@pm-collab/core/setup/service";
import { getSystemSettings } from "@pm-collab/core/shared/system-settings";
import { SetupWizard } from "@/components/setup/SetupWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "安装小围空间", robots: { index: false, follow: false } };

/**
 * 首次安装向导（Figma「83 首次安装向导」84～87）。
 * 没有系统管理员时任何人可打开（凭安装码）；建好管理员后，只有系统超管能看第 3、4 步，其他情况一律 404。
 */
export default async function SetupPage(props: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await props.searchParams;
  if (await needsSetup()) return <SetupWizard initialStep="code" defaultSystemName="" />;
  const session = await getSession();
  if (session?.globalRole === "admin" && (step === "basics" || step === "done")) {
    const settings = await getSystemSettings();
    return <SetupWizard initialStep={step} defaultSystemName={settings.name} />;
  }
  notFound();
}

"use client";

import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/ActionMenu";

export function ReleaseRowMenu({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ActionMenu
      label={`「${name}」更多操作`}
      items={[
        { label: "打开详情", onSelect: () => router.push(`/releases/${id}`) },
        { label: "复制链接", onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}/releases/${id}`) },
      ]}
    />
  );
}

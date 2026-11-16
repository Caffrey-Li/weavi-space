"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export type Movable = { id: string; status: string; title: string };

export type MoveFailure = { to: string; from: string; message: string; unknown?: boolean };

/**
 * 看板 / 列表 / 详情共用的「改状态」流程（MOTION-UX M14 / F02）：
 * - 立即乐观更新 + pending（同一条目不并发）
 * - 服务端明确成功：Toast「已放入 X」+ 撤销（撤销走同一个状态接口）
 * - 明确失败：回到原状态，条目上标红并给出「重试」
 * - 网络结果未知：不盲目重试，先重新读取服务端状态
 */
export function useStatusMover<T extends Movable>({
  setItems,
  url,
  labelOf,
  noun = "需求",
}: {
  setItems: Dispatch<SetStateAction<T[]>>;
  url: (id: string) => string;
  labelOf: (status: string) => string;
  noun?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Record<string, MoveFailure>>({});
  const savingRef = useRef(saving);
  savingRef.current = saving;

  const patchItem = useCallback(
    (id: string, status: string) => setItems((list) => list.map((it) => (it.id === id ? { ...it, status } : it))),
    [setItems],
  );

  const move = useCallback(
    async (item: T, to: string, opts: { silent?: boolean } = {}): Promise<boolean> => {
      const from = item.status;
      if (from === to || savingRef.current.has(item.id)) return false;

      setFailed((f) => {
        if (!f[item.id]) return f;
        const next = { ...f };
        delete next[item.id];
        return next;
      });
      setSaving((s) => new Set(s).add(item.id));
      patchItem(item.id, to);

      const done = () =>
        setSaving((s) => {
          const n = new Set(s);
          n.delete(item.id);
          return n;
        });

      try {
        const res = await fetch(url(item.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: to }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          patchItem(item.id, from);
          const message = (data as { error?: string }).error || `未能改为「${labelOf(to)}」`;
          setFailed((f) => ({ ...f, [item.id]: { to, from, message } }));
          toast.error(`「${item.title}」${message}，已回到「${labelOf(from)}」`);
          done();
          return false;
        }
        done();
        if (!opts.silent) {
          toast.show({
            tone: "success",
            message: `「${item.title}」已放入「${labelOf(to)}」`,
            action: {
              label: "撤销",
              onClick: () => {
                void move({ ...item, status: to }, from, { silent: true }).then((ok) => {
                  if (ok) toast.success(`已撤销，${noun}回到「${labelOf(from)}」`);
                });
              },
            },
          });
        }
        router.refresh();
        return true;
      } catch {
        // 结果未知：不回滚成「失败」，而是标注并重新读取服务端的真实状态
        setFailed((f) => ({
          ...f,
          [item.id]: { to, from, message: "网络异常，结果未确认，已重新读取", unknown: true },
        }));
        done();
        router.refresh();
        return false;
      }
    },
    [labelOf, noun, patchItem, router, toast, url],
  );

  const dismiss = useCallback((id: string) => {
    setFailed((f) => {
      const next = { ...f };
      delete next[id];
      return next;
    });
  }, []);

  return { move, saving, failed, dismiss };
}

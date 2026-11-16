"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, Pencil, Plus, Star } from "lucide-react";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createDocPage, refreshDocsTree } from "./DocsNav";

type TreePage = { id: string; parentId: string | null; title: string };

/** 阅读页右上角：编辑 · 加星标 · 复制链接 · 更多（新建子页面 / 移动 / 历史版本 / 删除） */
export function DocPageActions({
  spaceId,
  pageId,
  title,
  parentId,
  starred: initialStarred,
  canEdit,
  noEdit,
}: {
  spaceId: string;
  pageId: string;
  title: string;
  parentId: string | null;
  starred: boolean;
  canEdit: boolean;
  /** 测试用例页没有富文本编辑，不显示「编辑」 */
  noEdit?: boolean;
  /** 子页面数（删除 / 归档时会一起处理） */
  childCount?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [starred, setStarred] = useState(initialStarred);
  const [moving, setMoving] = useState(false);

  async function toggleStar() {
    const next = !starred;
    setStarred(next);
    const res = await fetch(`/api/docs/pages/${pageId}/star`, { method: next ? "POST" : "DELETE" });
    if (!res.ok) {
      setStarred(!next);
      toast.error("操作失败，请重试");
    } else {
      toast.success(next ? "已加星标" : "已取消星标");
      router.refresh();
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("#")[0]);
      toast.success("页面链接已复制");
    } catch {
      toast.error("复制失败，请手动复制地址栏链接");
    }
  }

  async function addChild() {
    try {
      const p = await createDocPage(spaceId, pageId);
      refreshDocsTree();
      router.push(`/docs/${spaceId}/pages/${p.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建页面失败");
    }
  }

  const runLifecycle = useLifecycle();
  async function act(action: "archive" | "delete") {
    const ok = await runLifecycle("doc", pageId, title, action, () =>
      router.push(parentId ? `/docs/${spaceId}/pages/${parentId}` : `/docs/${spaceId}`),
    );
    if (ok) refreshDocsTree();
  }

  return (
    <div className="doc-actions">
      {canEdit && !noEdit ? (
        <Link href={`/docs/${spaceId}/pages/${pageId}/edit`} className="btn-secondary">
          <Pencil size={14} aria-hidden="true" />
          编辑
        </Link>
      ) : null}
      <button
        type="button"
        className={`icon-button${starred ? " is-starred" : ""}`}
        aria-label={starred ? "取消星标" : "加星标"}
        aria-pressed={starred}
        title={starred ? "取消星标" : "加星标"}
        onClick={() => void toggleStar()}
      >
        <Star size={16} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
      </button>
      <button type="button" className="icon-button" aria-label="复制页面链接" title="复制页面链接" onClick={() => void copyLink()}>
        <LinkIcon size={16} aria-hidden="true" />
      </button>
      <ActionMenu
        label="更多页面操作"
        items={[
          ...(canEdit
            ? [
                { label: "新建子页面", onSelect: () => void addChild() },
                { label: "移动到…", onSelect: () => setMoving(true) },
              ]
            : []),
          { label: "历史版本", onSelect: () => router.push(`/docs/${spaceId}/pages/${pageId}/history`) },
          ...(canEdit
            ? [
                { label: "归档页面", divider: true, onSelect: () => void act("archive") },
                { label: "删除页面", onSelect: () => void act("delete"), tone: "danger" as const },
              ]
            : []),
        ]}
      />
      {canEdit ? (
        <MovePageModal
          open={moving}
          onClose={() => setMoving(false)}
          spaceId={spaceId}
          pageId={pageId}
          parentId={parentId}
        />
      ) : null}
    </div>
  );
}

/** 「新建子页面」的独立按钮，空页面状态里用 */
export function NewChildPageButton({
  spaceId,
  parentId,
  label = "新建页面",
  className = "btn-primary",
}: {
  spaceId: string;
  parentId?: string | null;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const p = await createDocPage(spaceId, parentId);
          refreshDocsTree();
          router.push(`/docs/${spaceId}/pages/${p.id}/edit`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "新建页面失败");
          setBusy(false);
        }
      }}
    >
      <Plus size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

function MovePageModal({
  open,
  onClose,
  spaceId,
  pageId,
  parentId,
}: {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  pageId: string;
  parentId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pages, setPages] = useState<TreePage[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  // 目标：页面 id，或 "group:<分组 id>"（放到该分组的根目录）
  const [target, setTarget] = useState(parentId || "");
  const [initial, setInitial] = useState(parentId || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(parentId || "");
    setInitial(parentId || "");
    fetch(`/api/docs/spaces/${spaceId}/tree`)
      .then((r) => r.json())
      .then((d) => {
        const list: (TreePage & { groupId?: string | null })[] = Array.isArray(d.pages) ? d.pages : [];
        setPages(list);
        setGroups(Array.isArray(d.groups) ? d.groups : []);
        if (!parentId) {
          const me = list.find((p) => p.id === pageId);
          const v = me?.groupId ? `group:${me.groupId}` : "";
          setTarget(v);
          setInitial(v);
        }
      })
      .catch(() => setPages([]));
  }, [open, spaceId, parentId, pageId]);

  // 可选的父页面：排除自己和自己的子孙，按树的顺序缩进显示
  const options = useMemo(() => {
    const kids = new Map<string | null, TreePage[]>();
    for (const p of pages) {
      if (!kids.has(p.parentId)) kids.set(p.parentId, []);
      kids.get(p.parentId)!.push(p);
    }
    const out: { id: string; label: string }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const p of kids.get(pid) || []) {
        if (p.id === pageId) continue;
        out.push({ id: p.id, label: `${"　".repeat(depth)}${p.title}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [pages, pageId]);

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/docs/pages/${pageId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target.startsWith("group:") ? { parentId: null, groupId: target.slice(6) } : { parentId: target || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error || "移动失败");
      return;
    }
    refreshDocsTree();
    toast.success("页面已移动");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="移动页面" busy={busy}>
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal-form-fields">
          <Field id="doc-move-parent" label="移动到" hint="页面连同它的子页面一起移动，放在新位置的最后。选分组即放到该分组的根目录。">
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {groups.length ? (
                <optgroup label="分组（根目录）">
                  {groups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option value="">空间根目录</option>
              )}
              <optgroup label="放到某个页面下">
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
        </div>
        <div className="modal-form-actions">
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy || target === initial} aria-busy={busy}>
            移动
          </button>
        </div>
      </form>
    </Modal>
  );
}

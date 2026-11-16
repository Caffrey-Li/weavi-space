"use client";

import { EnterpriseSelect, useEnterprises } from "@/components/projects/EnterpriseSelect";
import { useConfirm } from "@/components/ui/Confirm";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { FloatingPop } from "@/components/ui/FloatingPop";
import { useToast } from "@/components/ui/Toast";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { PRODUCT_STATUS } from "@/lib/products";
import { notifyProductsChanged } from "./ProductNav";
import type { ProductEnv } from "@/lib/product-envs";

export type ProductFormValues = { name: string; code: string; description: string; ownerId: string; status: string; projectIds: string[]; environments?: ProductEnv[] };
type MetaUser = { id: string; name: string };
type MetaProject = { id: string; name: string; iconUrl?: string | null };

const EMPTY: ProductFormValues = { name: "", code: "", description: "", ownerId: "", status: "planning", projectIds: [], environments: [] };

/** 新建 / 编辑产品（Figma 29，Modal 600）：说明 → 名称 + 编码 → 负责人 + 状态 → 描述 → 关联项目（胶囊 + 添加项目）→ 初始功能结构（单选卡）→ 页脚说明 + 取消 / 创建产品 */
export function ProductFormModal({
  open,
  productId,
  initial = EMPTY,
  products = [],
  onClose,
}: {
  open: boolean;
  /** 有值为编辑 */
  productId?: string;
  initial?: ProductFormValues;
  /** 新建时「复制已有产品」的来源 */
  products?: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [form, setForm] = useState(initial);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyMode, setCopyMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const [users, setUsers] = useState<MetaUser[]>([]);
  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setCopyFrom("");
    setCopyMode(false);
    setAdding(false);
    setError("");
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setUsers(d.users || []);
        setProjects(d.projects || []);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 只有系统管理员拿得到企业列表。新建默认第一个企业，编辑读产品当前的企业
  const { enterprises } = useEnterprises(open);
  const [enterpriseId, setEnterpriseId] = useState("");
  const [savedEnterprise, setSavedEnterprise] = useState("");
  useEffect(() => {
    if (!open || !enterprises.length) return;
    if (!productId) {
      setEnterpriseId((v) => v || enterprises[0].id);
      return;
    }
    fetch(`/api/products/${productId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { product?: { enterpriseId?: string } }) => {
        setEnterpriseId(d.product?.enterpriseId || "");
        setSavedEnterprise(d.product?.enterpriseId || "");
      })
      .catch(() => undefined);
  }, [open, enterprises, productId]);
  const moving = Boolean(productId) && enterprises.length > 0 && enterpriseId !== savedEnterprise;

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || Boolean(copyFrom) || moving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) return setError("请填写产品名称");
    if (!form.code.trim()) return setError("请填写产品编码");
    if (!productId && !/^[A-Z][A-Z0-9]{1,19}$/.test(form.code)) return setError("产品编码需以大写字母开头，2–20 位大写字母和数字");
    if (moving && !(await confirm({ title: "调整产品的所属企业？", body: "产品下的项目，以及项目的需求、Bug、发版、文档，会一起转到新企业。原企业的人将看不到这些内容。" }))) return;
    setSaving(true);
    setError("");
    const res = await fetch(productId ? `/api/products/${productId}` : "/api/products", {
      method: productId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, environments: undefined, ...(productId ? {} : { copyFrom: copyFrom || null, enterpriseId: enterpriseId || undefined }), ...(moving ? { enterpriseId: enterpriseId || null } : {}) }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setError((data as { error?: string }).error || "保存失败，输入已保留");
      return;
    }
    onClose();
    notifyProductsChanged();
    toast.success(productId ? "产品已保存" : `已新建产品「${form.name.trim()}」`);
    router.refresh();
    if (!productId && (data as { id?: string }).id) router.push(`/products/${(data as { id: string }).id}`);
  }

  function toggleProject(id: string) {
    setForm((f) => ({ ...f, projectIds: f.projectIds.includes(id) ? f.projectIds.filter((x) => x !== id) : [...f.projectIds, id] }));
  }
  const chosen = form.projectIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean) as MetaProject[];
  const rest = projects.filter((p) => !form.projectIds.includes(p.id));

  return (
    <Modal open={open} onClose={onClose} title={productId ? "编辑产品信息" : "新建产品"} dirty={dirty} busy={saving} panelClassName="nv-prod-modal">
      <form onSubmit={submit} className="nv-pform" noValidate>
        <p className="nv-pform-intro">产品用于维护系统名称和功能结构，需求、Bug、发版都可以归属到产品的功能模块。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <div className="nv-pform-row">
            <label className="nv-pfield nv-pform-grow" htmlFor={`${baseId}-name`}>
              <span className="nv-pfield-label">
                产品名称<em aria-hidden="true">*</em>
              </span>
              <input
                id={`${baseId}-name`}
                className="input"
                value={form.name}
                maxLength={60}
                placeholder="如 客户成功平台"
                data-initial-focus=""
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, name: v })); }}
              />
            </label>
            <label className="nv-pfield nv-pform-code" htmlFor={`${baseId}-code`}>
              <span className="nv-pfield-label">
                产品编码<em aria-hidden="true">*</em>
              </span>
              <input
                id={`${baseId}-code`}
                className="input"
                value={form.code}
                maxLength={20}
                placeholder="CSP"
                readOnly={Boolean(productId)}
                aria-describedby={`${baseId}-code-hint`}
                onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); setForm((f) => ({ ...f, code: v })); }}
              />
              <span id={`${baseId}-code-hint`} className="nv-pfield-hint">
                {productId ? "编码创建后不可修改" : "大写字母和数字，创建后不可修改"}
              </span>
            </label>
          </div>
          {enterprises.length ? (
            <label className="nv-pfield" htmlFor={`${baseId}-enterprise`}>
              <span className="nv-pfield-label">所属企业</span>
              <EnterpriseSelect id={`${baseId}-enterprise`} value={enterpriseId} options={enterprises} onChange={setEnterpriseId} />
              {productId ? <span className="nv-pfield-hint">修改后，产品下的项目和它们的需求、Bug、发版、文档会一起转到新企业</span> : null}
            </label>
          ) : null}
          <div className="nv-pform-row">
            <label className="nv-pfield nv-pform-grow" htmlFor={`${baseId}-owner`}>
              <span className="nv-pfield-label">负责人</span>
              <select id={`${baseId}-owner`} className="input" value={form.ownerId} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, ownerId: v })); }}>
                <option value="">未指定</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="nv-pfield">
              <span className="nv-pfield-label">状态</span>
              <div className="nv-pform-seg" role="group" aria-label="产品状态">
                {PRODUCT_STATUS.map((st) => (
                  <button key={st.key} type="button" aria-pressed={form.status === st.key} onClick={() => setForm((f) => ({ ...f, status: st.key }))}>
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="nv-pfield" htmlFor={`${baseId}-desc`}>
            <span className="nv-pfield-label">描述</span>
            <textarea
              id={`${baseId}-desc`}
              className="input nv-pform-desc"
              value={form.description}
              maxLength={500}
              placeholder="一句话描述这个系统 / 产品的用途"
              onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, description: v })); }}
            />
          </label>
          <div className="nv-pfield">
            <span className="nv-pfield-label">关联项目</span>
            <div className="nv-pform-chips">
              {chosen.map((p) => (
                <span key={p.id} className="nv-pform-chip">
                  <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                  {p.name}
                  <button type="button" aria-label={`移除 ${p.name}`} onClick={() => toggleProject(p.id)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <div className="nv-pform-add-wrap">
                <button
                  ref={addRef}
                  type="button"
                  className="nv-pform-add"
                  aria-haspopup="menu"
                  aria-expanded={adding}
                  disabled={!rest.length}
                  title={rest.length ? undefined : "没有可添加的项目"}
                  onClick={() => setAdding((v) => !v)}
                >
                  <Plus size={12} aria-hidden="true" />
                  添加项目
                </button>
                {/* 浮层挂到弹窗层，不会被弹窗滚动区裁掉；下方空间不够时向上翻 */}
                <FloatingPop anchorRef={addRef} open={adding} onClose={() => setAdding(false)} width={240} className="nv-menu nv-pform-menu" role="menu" label="添加项目">
                    {rest.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="menuitem"
                        className="nv-menu-item"
                        onClick={() => {
                          toggleProject(p.id);
                          setAdding(false);
                        }}
                      >
                        <ProjectIcon name={p.name} src={p.iconUrl} size={16} />
                        {p.name}
                      </button>
                    ))}
                </FloatingPop>
              </div>
            </div>
          </div>
          {!productId ? (
            <div className="nv-pfield">
              <span className="nv-pfield-label">初始功能结构</span>
              <div className="nv-pform-cards" role="radiogroup" aria-label="初始功能结构">
                <label className={`nv-pform-card${!copyMode ? " is-on" : ""}`}>
                  <input type="radio" aria-label="空白开始" name={`${baseId}-init`} checked={!copyMode} onChange={() => (setCopyMode(false), setCopyFrom(""))} />
                  <span>
                    <b>空白开始</b>
                    <small>创建后在「功能结构」里逐级新增菜单和模块</small>
                  </span>
                </label>
                <label className={`nv-pform-card${copyMode ? " is-on" : ""}${products.length ? "" : " is-disabled"}`}>
                  <input
                    type="radio"
                    aria-label="复制已有产品"
                    name={`${baseId}-init`}
                    checked={copyMode}
                    disabled={!products.length}
                    onChange={() => (setCopyMode(true), setCopyFrom(products[0]?.id || ""))}
                  />
                  <span>
                    <b>复制已有产品</b>
                    <small>从已有产品复制菜单 › 模块 › 功能点结构</small>
                    {copyMode ? (
                      <select className="input nv-pform-copy" value={copyFrom} aria-label="复制哪个产品的功能结构" onChange={(e) => setCopyFrom(e.target.value)}>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </span>
                </label>
              </div>
            </div>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">创建后可在列表中编辑或归档；有关联需求的产品不能删除</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="submit" className="btn-primary nv-head-btn" disabled={saving} aria-busy={saving || undefined}>
            {saving ? "保存中…" : productId ? "保存" : "创建产品"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewProductButton({
  className = "btn-primary nv-head-btn",
  autoOpen = false,
  products = [],
}: {
  className?: string;
  autoOpen?: boolean;
  products?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  // 已经在产品列表时点侧栏「新建产品」（只改了 ?new=1），组件不会重新挂载：跟着参数打开
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        新建产品
      </button>
      <ProductFormModal
        open={open}
        products={products}
        onClose={() => {
          setOpen(false);
          // 从侧栏 ?new=1 打开的，关掉后把参数去掉，避免刷新又弹出
          if (autoOpen) router.replace("/products");
        }}
      />
    </>
  );
}

import Link from "next/link";
import { Search } from "lucide-react";
import { getSession } from "@/lib/auth";
import { fmtAgo, pageDisplayTitle } from "@/lib/docs";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { DocPageList } from "@/components/docs/DocPageList";
import { DocsLevels, type LevelDoc, type LevelProduct, type LevelProject } from "@/components/docs/DocsLevels";
import { NewDocHeadButton } from "@/components/docs/NewDocHeadButton";
import { emptyCounts, DOC_TYPES } from "@/lib/doc-stats";
import { docsData } from "../../../docs/docsData-query";

const TYPE_LABEL = Object.fromEntries(DOC_TYPES.map((t) => [t.key, t.label])) as Record<string, string>;

/** 文档 · 所有空间（Figma 13 / 48 / 49）：按 产品 / 项目 / 文档 三个层级浏览，各层级都能新建文档 */
export default async function DocsPage(props: { searchParams: Promise<{ q?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await getSession();
  if (!user) return null;
  const q = searchParams.q?.trim() || "";
  const { tree, ref, all, canCreate } = await docsData(user);
  const hit = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  const products: LevelProduct[] = tree.products
    .filter((p) => hit(p.name) || hit(p.code))
    .map((p) => ({ id: p.id, name: p.name, code: p.code, desc: p.description || "", spaceId: p.spaceId, projectCount: p.projects.length, counts: p.counts || emptyCounts() }));

  const projectList = [
    ...tree.products.flatMap((p) => p.projects.map((x) => ({ x, productName: p.name as string | null }))),
    ...tree.unassigned.map((x) => ({ x, productName: null as string | null })),
  ];
  const projects: LevelProject[] = projectList
    .filter(({ x }) => hit(x.name) || hit(x.key || ""))
    .map(({ x, productName }) => ({
      id: x.id,
      name: x.name,
      key: x.key || "",
      iconUrl: x.iconUrl,
      productName,
      counts: x.counts || emptyCounts(),
      // 只列根页面里最近更新的 3 篇
      docs: all
        .filter((d) => d.spaceId === x.id && !d.parentId)
        .slice(0, 3)
        .map((d) => ({ id: d.id, title: pageDisplayTitle(d), type: d.type, typeLabel: d.type === "other" ? d.groupName : TYPE_LABEL[d.type] })),
    }));

  const docRow = (d: (typeof all)[number]) => {
    const s = ref.get(d.spaceId);
    const where = s ? (s.level === "product" ? s.name : `${s.productName ? `${s.productName} › ` : ""}${s.name}`) : "";
    return {
      id: d.id,
      spaceId: d.spaceId,
      title: pageDisplayTitle(d),
      sub: [where, d.groupName].filter(Boolean).join(" · "),
      who: d.updatedBy?.name || "—",
      whoAvatar: d.updatedBy?.avatarUrl,
      when: fmtAgo(d.updatedAt),
      draft: d.version === 0,
      tag: s ? { label: s.level === "product" ? "产品层级" : "项目层级", tone: s.level === "product" ? "is-purple" : "is-info" } : undefined,
    };
  };
  const docs: LevelDoc[] = all
    .filter((d) => hit(pageDisplayTitle(d)))
    .slice(0, 200)
    .map((d) => ({ ...docRow(d), type: d.type }));
  const recent = all.slice(0, 4).map(docRow);

  return (
    <div className="nv-page-flush nv-docs-home">
      <WorkHeader
        crumbs={[{ label: "所有空间", icon: "book" }]}
        actions={
          <>
            <form role="search" className="nv-head-search is-static">
              <Search size={14} aria-hidden="true" />
              <input name="q" type="search" defaultValue={q} placeholder="搜索产品、项目或文档" aria-label="搜索产品、项目或文档" enterKeyHint="search" />
            </form>
            {canCreate ? <NewProjectButton label="新建空间" afterCreate="space" className="btn-secondary nv-head-btn" /> : null}
            <NewDocHeadButton />
          </>
        }
      />
      <DocsLevels products={products} projects={projects} docs={docs} q={q}>
        <section className="nv-docs-recent" aria-labelledby="docs-recent">
          <div className="nv-leader-section-head">
            <h2 id="docs-recent">最近更新</h2>
            <Link href="/docs/recent" className="btn-ghost nv-head-btn">
              查看全部
            </Link>
          </div>
          <DocPageList showName empty="还没有文档。点右上角「新建文档」开始。" rows={recent} />
        </section>
      </DocsLevels>
    </div>
  );
}

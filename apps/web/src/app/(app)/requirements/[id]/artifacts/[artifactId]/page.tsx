import { reqCodeOf } from "@pm-collab/core/shared/codes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Download } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { artifactForPreview } from "@pm-collab/core/requirements/artifacts";
import { ARTIFACT_LABEL } from "@pm-collab/core/shared/artifacts-shared";

/** 资料预览（T42，Figma 88C）：UI 设计 / 原型 / 图片；HTML 原型只在沙箱里打开 */
export default async function ArtifactPreviewPage(props: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await props.params;
  const session = await getSession();
  if (!session) notFound();
  const v = await artifactForPreview(session, id, artifactId);
  if (!v) notFound();
  const r = await prisma.requirement.findUnique({ where: { id }, select: { id: true, number: true, title: true, projectId: true, project: { select: { id: true, name: true, key: true, iconUrl: true } } } });
  if (!r) notFound();
  const code = reqCodeOf(r);
  const back = `/requirements/${r.id}`;
  const a = v.current;
  const html = v.file?.mime === "text/html";
  const img = v.file?.mime.startsWith("image/");

  return (
    <div className="nv-page-flush">
      <PageContext
        scope={r.project ? "project" : "global"}
        projectId={r.projectId}
        crumbs={[...(r.project ? [{ label: r.project.name, href: `/projects/${r.project.id}` }] : []), { label: code, href: back }, { label: "资料" }]}
      />
      <WorkHeader
        crumbs={[
          ...(r.project ? [{ label: r.project.name, href: `/projects/${r.project.id}`, project: { name: r.project.name, iconUrl: r.project.iconUrl } }] : []),
          { label: code, href: back },
          { label: "资料" },
        ]}
      />
      <div className="nv-artv">
        <div className="nv-artv-bar">
          <nav className="nv-artv-bar" aria-label="资料切换">
            {v.tabs.map((t) => (
              <Link key={t.id} className="nv-artv-tab" href={t.href.startsWith("/requirements/") ? t.href : `/requirements/${r.id}/artifacts/${t.id}`} aria-current={t.id === a.id ? "page" : undefined} title={t.title}>
                <span className="nv-ra-kind" data-kind={t.kind}>
                  {ARTIFACT_LABEL[t.kind]}
                </span>
                <span>{t.title}</span>
              </Link>
            ))}
          </nav>
          <span className="nv-artv-meta">
            {a.meta}
            {a.note ? ` · ${a.note}` : ""}
          </span>
          {v.file ? (
            <a className="btn-secondary nv-head-btn" href={`${v.file.raw}?download=1`}>
              <Download size={14} aria-hidden="true" />
              下载
            </a>
          ) : null}
          {v.url ? (
            <a className="btn-secondary nv-head-btn" href={v.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              新窗口打开
            </a>
          ) : null}
          <Link className="btn-primary nv-head-btn" href={back}>
            返回需求
          </Link>
        </div>
        {html ? (
          <p className="nv-artv-warn" role="note">
            <b>沙箱预览</b>原型里的脚本可以运行，但读不到你的登录信息，也调不了系统接口。表单提交和网络请求在原型里不生效。
          </p>
        ) : null}
        <div className="nv-artv-stage">
          {html && v.file ? (
            <iframe src={v.file.raw} title={a.title} sandbox="allow-scripts allow-modals allow-popups" referrerPolicy="no-referrer" />
          ) : img && v.file ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.file.raw} alt={a.title} />
          ) : v.embed ? (
            <iframe src={v.embed} title={a.title} allowFullScreen referrerPolicy="no-referrer" />
          ) : (
            <div className="nv-artv-card">
              <p>这个网站不允许嵌入预览，请在新窗口打开。</p>
              {v.url ? (
                <a className="btn-primary nv-head-btn" href={v.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} aria-hidden="true" />
                  打开 {a.title}
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { FileText } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

export type DocListRow = {
  id: string;
  spaceId: string;
  title: string;
  sub: string;
  who: string;
  whoAvatar?: string | null;
  when: string;
  draft?: boolean;
  /** 行尾标签（文档层级列表里标「产品层级 / 项目层级」） */
  tag?: { label: string; tone: string };
};

/** 页面列表行（空间首页「最近更新」、最近更新、加星标共用） */
export function DocPageList({ rows, empty, showName = false }: { rows: DocListRow[]; empty: string; showName?: boolean }) {
  if (!rows.length) return <p className="empty-inline">{empty}</p>;
  return (
    <ul className="doc-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/docs/${r.spaceId}/pages/${r.id}`} className="doc-list-row">
            <FileText size={18} aria-hidden="true" className="doc-list-icon" />
            <span className="doc-list-main">
              <span className="doc-list-title">
                {r.title}
                {r.draft ? <span className="doc-tree-draft">草稿</span> : null}
              </span>
              <span className="doc-list-sub">{r.sub}</span>
            </span>
            {r.tag ? <span className={`nv-tag ${r.tag.tone} doc-list-tag`}>{r.tag.label}</span> : null}
            <span className="doc-list-who" title={r.who}>
              <Avatar name={r.who} src={r.whoAvatar} size={16} />
              {showName ? <span className="doc-list-who-name">{r.who}</span> : null}
            </span>
            <span className="doc-list-when">{r.when}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

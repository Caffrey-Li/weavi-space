"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";

export type SkillFile = { path: string; content: string };

/**
 * T35 skill 的参考文件：选本机的 .md / .txt / .yaml / .json 等文本文件（可多选），在浏览器里读成文字一起保存。
 * 文件名默认放在 references/ 下，可以改。和服务端同样的限制：最多 20 个，每个 10 万字以内。
 */
export function SkillFilesInput({ files, onChange }: { files: SkillFile[]; onChange: (f: SkillFile[]) => void }) {
  const id = useId();
  const [error, setError] = useState("");
  async function pick(list: FileList | null) {
    if (!list) return;
    setError("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > 400_000) {
        setError(`${f.name} 太大（文本文件 400 KB 以内）`);
        continue;
      }
      const text = await f.text();
      if (/\u0000/.test(text)) {
        setError(`${f.name} 不是文本文件`);
        continue;
      }
      const path = `references/${f.name.replace(/[^\w一-龥.\- ]/g, "_")}`;
      if (next.some((x) => x.path === path)) continue;
      next.push({ path, content: text.slice(0, 100_000) });
    }
    onChange(next.slice(0, 20));
  }
  return (
    <div className="nv-pfield">
      <span className="nv-pfield-label">参考文件（可选）</span>
      {files.length ? (
        <ul className="nv-skfiles">
          {files.map((f, i) => (
            <li key={f.path}>
              <input
                className="input"
                aria-label="文件路径"
                value={f.path}
                onChange={(e) => onChange(files.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
              />
              <span className="nv-skfiles-size">{f.content.length.toLocaleString()} 字</span>
              <button type="button" className="btn-ghost nv-head-btn" aria-label={`移除 ${f.path}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="btn-secondary nv-head-btn nv-skfiles-add" htmlFor={`${id}-f`}>
        添加文件
        <input id={`${id}-f`} type="file" multiple accept=".md,.markdown,.txt,.yaml,.yml,.json,.csv" className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      </label>
      <span className="nv-pfield-hint">模板、检查清单、示例等文本文件，执行时和 SKILL.md 一起交给模型。最多 20 个，每个 10 万字以内，合计 30 万字以内。</span>
      {error ? <span className="nv-set-error" role="alert">{error}</span> : null}
    </div>
  );
}

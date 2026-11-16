/** 筛选条：把 URL 上的筛选参数变成「字段 值 ×」，移除时保留其他参数并回到第 1 页 */
export function appliedFilters(
  base: string,
  params: Record<string, string | undefined | null>,
  defs: { key: string; field: string; label: (v: string) => string | undefined }[],
) {
  const hrefWithout = (key: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== key && k !== "page") sp.set(k, v);
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  };
  return defs
    .filter((d) => params[d.key])
    .map((d) => ({ field: d.field, value: d.label(params[d.key] as string) || (params[d.key] as string), removeHref: hrefWithout(d.key) }));
}

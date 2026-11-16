export function parsePageParams(
  searchParams: { page?: string; pageSize?: string } | Record<string, string | string[] | undefined>,
  defaults: { page?: number; pageSize?: number } = {}
) {
  const rawPage = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const rawSize = Array.isArray(searchParams.pageSize)
    ? searchParams.pageSize[0]
    : searchParams.pageSize;
  let page = Number(rawPage) || defaults.page || 1;
  let pageSize = Number(rawSize) || defaults.pageSize || 100;
  if (![20, 50, 100].includes(pageSize)) pageSize = defaults.pageSize || 100;
  if (page < 1) page = 1;
  return { page, pageSize };
}

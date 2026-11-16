/**
 * One-shot / CLI sync: Feishu 排期表→ 需求池
 *
 * Usage:
 *   npx tsx scripts/sync-itr.ts              # auto: tmp/itr-rows.json → lark-cli → API
 *   npx tsx scripts/sync-itr.ts --mode file
 *   npx tsx scripts/sync-itr.ts --mode cli
 *   npx tsx scripts/sync-itr.ts --mode api
 *   npx tsx scripts/sync-itr.ts --file tmp/itr-rows.json
 *   npx tsx scripts/sync-itr.ts --dry-run
 */
import path from "path";
import { syncItrRows } from "../apps/web/src/lib/itr-sync";
import { fetchItrRows, type FetchMode } from "../apps/web/src/lib/feishu-itr";

async function main() {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf("--mode");
  const fileIdx = args.indexOf("--file");
  const dryRun = args.includes("--dry-run");
  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "auto") as FetchMode;
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined;

  console.log("Fetching ITR rows…", { mode, filePath, dryRun });
  const rows = await fetchItrRows(mode, filePath);
  console.log(`Got ${rows.length} rows`);
  const result = await syncItrRows(rows, { dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

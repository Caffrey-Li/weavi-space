import { getSession } from "@/lib/auth";
import { loadRequirementsPool as loadPool, type RequirementsPoolOptions } from "@pm-collab/core/requirements/pool-query";
export { toPoolRows, type PoolRow, type RequirementsPoolSearch } from "@pm-collab/core/requirements/pool-query";

export async function loadRequirementsPool(opts: RequirementsPoolOptions) {
  return loadPool(opts, await getSession());
}

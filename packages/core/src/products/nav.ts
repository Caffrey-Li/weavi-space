import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { loadProductNav } from "./nav-query";

export async function GET(session: SessionUser) {
  return result(await loadProductNav(session));
}

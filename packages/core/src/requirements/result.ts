import type { RevisionConflict } from "../shared/optimistic";

export function result(body: unknown, init?: { status: number }) {
  return { body, init };
}

export function conflictResult(e: RevisionConflict) {
  return result({ error: e.message, code: "revision_conflict", revision: e.current }, { status: 409 });
}

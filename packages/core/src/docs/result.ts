import type { RevisionConflict } from "../shared/optimistic";
export type InputBody = Record<string, string | number | boolean | null | string[] | undefined>;
export type DocAccess = { url: string; body: InputBody | null };
export function result(body: unknown, init?: { status?: number }) { return { body, init }; }
export function error(message: string, status: number) { return result({ error: message }, { status }); }
export function conflictResult(e: RevisionConflict) { return result({ error: e.message, code: "revision_conflict", revision: e.current }, { status: 409 }); }

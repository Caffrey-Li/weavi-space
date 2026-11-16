export type OverlayPhase = "closed" | "opening" | "open" | "closing";

export function decideClose(input: { busy: boolean; dirty: boolean }) {
  if (input.busy) return "confirm-busy" as const;
  if (input.dirty) return "confirm-dirty" as const;
  return "close" as const;
}

export function isLatestGeneration(ticket: number, current: number) {
  return ticket === current;
}

/** Maps the committed phase to the frame the user should see. Reopening during exit stays on the open target. */
export function visualPhase(open: boolean, phase: OverlayPhase): OverlayPhase {
  if (!open) return phase === "closed" ? "closed" : "closing";
  if (phase === "closed") return "opening";
  if (phase === "closing") return "open";
  return phase;
}

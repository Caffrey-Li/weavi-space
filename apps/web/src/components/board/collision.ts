import { pointerWithin, rectIntersection, type CollisionDetection, type UniqueIdentifier } from "@dnd-kit/core";
import { defaultDropAnimationSideEffects, type DropAnimation } from "@dnd-kit/core";
import { DOCK_PREFIX, statusFromDropId } from "./StatusDock";

/** 指针落在状态抽屉的某个口子上时，抽屉优先于下面被遮住的看板列。 */
export const dockFirstCollision: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  const dock = under.filter((c) => String(c.id).startsWith(DOCK_PREFIX));
  if (dock.length) return dock;
  if (under.length) return under;
  // 指针不在任何目标上时，只按矩形相交兜底看板列；抽屉口子必须指针真正落上去才算，避免误投
  return rectIntersection(args).filter((c) => !String(c.id).startsWith(DOCK_PREFIX));
};

/** 放下目标 → 目标状态：抽屉口子 / 看板列 / 落在某张卡片上则取那张卡片的状态 */
export function resolveDropStatus(
  overId: UniqueIdentifier,
  columnKeys: string[],
  statusOfCard: (id: string) => string | undefined,
): string | null {
  const fromDock = statusFromDropId(overId);
  if (fromDock) return fromDock;
  const id = String(overId);
  if (columnKeys.includes(id)) return id;
  return statusOfCard(id) ?? null;
}

/** 松手时卡片飞回落点（新列或原位），让移入、移出更明显 */
export const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

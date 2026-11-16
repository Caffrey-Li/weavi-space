"use client";

import { useCallback, useEffect, useState } from "react";

/** 列表「显示」设置（分组方式 + 显示哪些属性），按浏览器记住 */
export type ListProp = "status" | "priority" | "owner" | "due" | "project";
export type ListGroup = "status" | "priority" | "owner" | "project" | "none";
export type ListDisplay = { group: ListGroup; props: Record<ListProp, boolean> };

export const LIST_GROUP_LABELS: Record<ListGroup, string> = {
  status: "状态",
  priority: "优先级",
  owner: "负责人",
  project: "项目",
  none: "不分组",
};

export const LIST_PROP_LABELS: Record<ListProp, string> = {
  status: "状态",
  priority: "优先级",
  owner: "负责人",
  due: "截止日期",
  project: "所属项目",
};

const KEY = "pm-list-display";
const EVENT = "pm:list-display";

export const DEFAULT_DISPLAY: ListDisplay = {
  group: "status",
  props: { status: true, priority: true, owner: true, due: true, project: true },
};

function read(): ListDisplay {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DISPLAY;
    const v = JSON.parse(raw) as Partial<ListDisplay>;
    return {
      group: v.group && v.group in LIST_GROUP_LABELS ? v.group : "status",
      props: { ...DEFAULT_DISPLAY.props, ...(v.props || {}) },
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function useListDisplay(): [ListDisplay, (next: ListDisplay) => void] {
  const [value, setValue] = useState<ListDisplay>(DEFAULT_DISPLAY);
  useEffect(() => {
    setValue(read());
    const sync = () => setValue(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((next: ListDisplay) => {
    setValue(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 存储不可用时只在本页生效 */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [value, update];
}

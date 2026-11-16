import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 小围执行工具时的调用上下文（T27 二期）：工具写库时会写动态，动态又可能触发自动化规则。
 * 用 AsyncLocalStorage 把「这次写入来自哪个任务、已经连锁了几层」带到动态的处理里，
 * 由此算出新任务的跳数，超过上限就熔断，避免规则之间互相触发停不下来。
 */
export type AgentCallContext = { taskId: string; hops: number };

const store = new AsyncLocalStorage<AgentCallContext>();

export function runInAgentContext<T>(ctx: AgentCallContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function currentAgentContext(): AgentCallContext | undefined {
  return store.getStore();
}

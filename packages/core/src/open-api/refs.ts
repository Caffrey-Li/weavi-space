/** 可选的开放接口引用范围检查；原有页面和接口不传入。 */
export type ReferenceGuard = (input: Record<string, unknown>) => Promise<boolean>;

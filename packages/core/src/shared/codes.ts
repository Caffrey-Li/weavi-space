/** 编号（T43）：需求 R1042、任务 T1562，全系统唯一（分支名、提交说明、MR 标题里引用，三期 GitLab 按它关联） */
export const reqCodeOf = (r: { number: number }) => `R${r.number}`;
export const taskCodeOf = (t: { number: number }) => `T${t.number}`;

/** 从文字里找出所有需求 / 任务编号（不区分大小写，前后不能紧挨字母数字） */
export function findCodes(text: string): { reqs: number[]; tasks: number[] } {
  const reqs = new Set<number>();
  const tasks = new Set<number>();
  const re = /(?<![A-Za-z0-9])([RT])-?(\d{1,9})(?![A-Za-z0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ""))) (m[1].toUpperCase() === "R" ? reqs : tasks).add(Number(m[2]));
  return { reqs: [...reqs], tasks: [...tasks] };
}

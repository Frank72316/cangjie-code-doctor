// Task lifecycle is transport evidence; compilation verdicts still come from Cangjie.
export const TASK_LABELS = {
  running:'编译中', completed:'任务完成', failed:'任务异常', cancelled:'已取消',
  timed_out:'已超时', interrupted:'服务中断', unknown:'状态待确认'
};
export function taskLabel(task) {
  if (task.state === 'completed' && task.record) return {
    compile_passed:'编译通过', compile_failed:'编译未通过', tool_error:'工具异常'
  }[task.record.normalized.status];
  return TASK_LABELS[task.state] || '状态待确认';
}
export function validTaskId(id) { return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id); }
export function validateTask(task) {
  if (task?.schemaVersion !== 1 || task.kind !== 'doctor-task' || !validTaskId(task.taskId) ||
      !Object.hasOwn(TASK_LABELS, task.state) || typeof task.caseId !== 'string' ||
      typeof task.startedAt !== 'string' || !Number.isFinite(Date.parse(task.startedAt)) ||
      !(task.finishedAt === null || (typeof task.finishedAt === 'string' && Number.isFinite(Date.parse(task.finishedAt)))) ||
      typeof task.detail !== 'string' || typeof task.reason !== 'string') throw new Error('任务状态记录无效。');
  if (task.record && (task.record.taskId !== task.taskId || task.record.source.name !== task.caseId + '.cj'))
    throw new Error('任务与诊断记录不匹配。');
  return task;
}

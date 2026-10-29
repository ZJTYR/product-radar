import { getWorkflowMetadata, sleep } from 'workflow';
import { start, getRun } from 'workflow/api';
import { getDatabase } from '../lib/database';
import { attemptScheduledEmail, registerEmailContinuation } from '../lib/email-schedule-store';
import { sendDailyEmail } from '../lib/email-store';

async function deliverAtScheduledTime(userId: string, generation: string, runId: string) {
  'use step';
  console.info('email.schedule.attempt');
  return attemptScheduledEmail(getDatabase(), userId, generation, runId, sendDailyEmail);
}
async function adoptNextRun(userId: string, generation: string, runId: string, nextRunId: string, nextRunAt: string) {
  'use step';
  const adopted = await registerEmailContinuation(getDatabase(), userId, generation, runId, nextRunId, nextRunAt);
  if (!adopted) { try { await getRun(nextRunId).cancel(); } catch { /* generation 门禁阻止迟到任务发信。 */ } }
  console.info('email.schedule.continuation', { adopted });
}

/** 一天一个运行，等待时不占进程；每日交接给当前正式版本，避免无限积累事件。 */
export async function emailScheduleWorkflow(userId: string, generation: string, firstRunAt: string) {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  let nextRunAt = firstRunAt;
  while (true) {
    if (Date.parse(nextRunAt) > Date.now()) await sleep(new Date(nextRunAt));
    const result = await deliverAtScheduledTime(userId, generation, workflowRunId);
    if (!result.active || !result.nextRunAt) return;
    if (result.retryToday) { nextRunAt = result.nextRunAt; continue; }
    const next = await start(emailScheduleWorkflow, [userId, generation, result.nextRunAt], { deploymentId: 'latest' });
    await adoptNextRun(userId, generation, workflowRunId, next.runId, result.nextRunAt);
    return;
  }
}

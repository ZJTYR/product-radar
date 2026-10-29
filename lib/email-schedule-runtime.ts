import { start, getRun } from 'workflow/api';
import { emailScheduleWorkflow } from '../workflows/email-schedule';
import type { EmailScheduleRuntime } from './email-schedule-store';

export const emailScheduleRuntime: EmailScheduleRuntime = {
  async start(userId, generation, nextRunAt) {
    const run = await start(emailScheduleWorkflow, [userId, generation, nextRunAt]);
    return run.runId;
  },
  async cancel(runId) { await getRun(runId).cancel(); },
  async status(runId) { return getRun(runId).status; },
};

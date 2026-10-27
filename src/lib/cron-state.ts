// Cron / task state (port-spec §4.3, F16).
// Sections: Running / Scheduled / Paused-attention — paused/error jobs stay
// visible beside Scheduled work so Resume is never hidden by the filter
// that surfaced them. Optimistic updates reconcile with the server list,
// never overwrite it.
import type { CronJob } from './types';

export type TaskSections = { running: CronJob[]; scheduled: CronJob[]; pausedAttention: CronJob[] };

export function jobKey(job: CronJob): string | null {
  return job.job_id || job.id || null;
}

export function normalizeCronJob(raw: Record<string, unknown>): CronJob | null {
  const job = raw as unknown as CronJob;
  if (!jobKey(job)) return null; // require job_id || id, else drop
  const schedule = raw.schedule_display ?? raw.schedule;
  return {
    ...job,
    schedule: typeof schedule === 'string' ? schedule : (schedule as { display?: string; expr?: string })?.display ?? (schedule as { expr?: string })?.expr ?? job.schedule,
  };
}

export function taskSections(jobs: CronJob[]): TaskSections {
  const running: CronJob[] = [];
  const scheduled: CronJob[] = [];
  const pausedAttention: CronJob[] = [];
  for (const job of jobs) {
    const state = (job.state ?? '').toLowerCase();
    const isPaused = job.enabled === false || state === 'paused' || state === 'disabled';
    const isError = state === 'error' || state === 'failed' || !!job.last_error;
    const isRunning = state === 'running' || state === 'active';
    if (isPaused || isError) pausedAttention.push(job);
    else if (isRunning) running.push(job);
    else scheduled.push(job);
  }
  return { running, scheduled, pausedAttention };
}

/** Reconcile an optimistic list with the server list: server wins on conflicts. */
export function reconcileTaskJobs(optimistic: CronJob[], server: CronJob[]): CronJob[] {
  const serverKeys = new Set(server.map(jobKey));
  const keptOptimistic = optimistic.filter((j) => {
    const key = jobKey(j);
    return key !== null && !serverKeys.has(key);
  });
  return [...server, ...keptOptimistic];
}

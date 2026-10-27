import { describe, expect, it } from 'vitest';
import { jobKey, normalizeCronJob, reconcileTaskJobs, taskSections } from '../src/lib/cron-state';
import type { CronJob } from '../src/lib/types';

const job = (over: Partial<CronJob> & { job_id: string }): CronJob => ({ ...over });

describe('task sections', () => {
  it('puts running, scheduled and paused-attention jobs in their sections', () => {
    const sections = taskSections([
      job({ job_id: 'r', state: 'running' }),
      job({ job_id: 's', state: 'scheduled', enabled: true }),
      job({ job_id: 'p', state: 'paused', enabled: false }),
      job({ job_id: 'e', state: 'scheduled', enabled: true, last_error: 'boom' }),
    ]);
    expect(sections.running.map(jobKey)).toEqual(['r']);
    expect(sections.scheduled.map(jobKey)).toEqual(['s']);
    // Paused AND error jobs stay visible beside scheduled work so Resume is never hidden.
    expect(sections.pausedAttention.map(jobKey).sort()).toEqual(['e', 'p']);
  });
});

describe('normalization', () => {
  it('drops jobs without job_id or id, with no crash', () => {
    expect(normalizeCronJob({ name: 'nameless' })).toBeNull();
  });
  it('prefers schedule_display over schedule.expr', () => {
    const out = normalizeCronJob({ job_id: 'j', schedule_display: 'Every hour', schedule: { expr: '0 * * * *' } });
    expect(out?.schedule).toBe('Every hour');
  });
});

describe('reconcileTaskJobs', () => {
  it('server list wins on conflict; optimistic-only jobs survive', () => {
    const server = [job({ job_id: 'a', name: 'server-name' })];
    const optimistic = [job({ job_id: 'a', name: 'optimistic-name' }), job({ job_id: 'b', name: 'local-only' })];
    const merged = reconcileTaskJobs(optimistic, server);
    expect(merged.find((j) => j.job_id === 'a')?.name).toBe('server-name');
    expect(merged.find((j) => j.job_id === 'b')?.name).toBe('local-only');
  });
});

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassDialog } from '../../src/components/glassyui/GlassDialog';
import { Row } from '../../src/components/Row';
import type { CronJob, CronRun } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

// Detail: schedule, next/last run, deliver, model, editable prompt,
// run history, Pause / Resume / Trigger now / Delete (confirm dialog).
// Optimistic row actions roll back on failure (reconcile with server).
export default function TaskDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [job, setJob] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [prompt, setPrompt] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    if (!gateway) return;
    try {
      const detail = (await gateway.cronDetail(jobId)) as CronJob;
      setJob(detail);
      setPrompt(detail.prompt ?? '');
      const history = (await gateway.cronRuns(jobId)) as { runs?: CronRun[] };
      setRuns(history.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this task.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, jobId]);

  const mutate = async (action: 'pause' | 'resume' | 'remove', label: string) => {
    if (!gateway || !job) return;
    const previous = job;
    setBusy(action);
    setJob({ ...job, enabled: action === 'resume' ? true : action === 'pause' ? false : job.enabled });
    try {
      const res = (await gateway.request('cron.manage', { action, name: jobId, ...(job.profile ? { profile: job.profile } : {}) })) as { ok?: boolean };
      if (res.ok === false) throw new Error(`Hermes could not ${label} this scheduled task.`);
      await load();
    } catch (e) {
      setJob(previous); // optimistic rollback
      setError(e instanceof Error ? e.message : `Hermes could not ${label} this scheduled task.`);
    } finally {
      setBusy(null);
    }
  };

  const trigger = async () => {
    if (!gateway) return;
    setBusy('trigger');
    try {
      await gateway.cronTrigger(jobId, job?.profile);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hermes could not trigger this task.');
    } finally {
      setBusy(null);
    }
  };

  const savePrompt = async () => {
    if (!gateway) return;
    try {
      await gateway.cronUpdatePrompt(jobId, prompt);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the prompt.');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>{job?.name ?? jobId}</Text>
        <Text style={[styles.meta, { color: palette.secondary }]}>Schedule: {job?.schedule ?? '—'}</Text>
        <Text style={[styles.meta, { color: palette.secondary }]}>Next run: {job?.next_run_at ?? '—'} · Last run: {job?.last_run_at ?? '—'} ({job?.last_status ?? '—'})</Text>
        <Text style={[styles.meta, { color: palette.secondary }]}>Deliver: {job?.deliver ?? '—'} · Model: {job?.model ?? job?.provider ?? '—'}</Text>
        {job?.last_error ? <GlassAlert tone="error" message={job.last_error} /> : null}
        <GlassInput label="Prompt" value={prompt} onChangeText={(t) => { setPrompt(t); setDirty(true); }} multiline numberOfLines={6} />
        {dirty ? <GlassButton title="Save prompt" variant="prominent" onPress={() => void savePrompt()} /> : null}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        <View style={styles.actions}>
          <GlassButton title={job?.enabled === false ? 'Resume' : 'Pause'} variant="primary" disabled={busy !== null} onPress={() => void mutate(job?.enabled === false ? 'resume' : 'pause', job?.enabled === false ? 'resume' : 'pause')} />
          <GlassButton title="Trigger now" variant="primary" disabled={busy !== null} onPress={() => void trigger()} />
          <GlassButton title="Delete task" variant="ghost" destructive disabled={busy !== null} onPress={() => setConfirmDelete(true)} />
        </View>
        <Text style={[styles.label, { color: palette.text }]}>Run history</Text>
        {runs.length === 0 ? (
          <Text style={[styles.meta, { color: palette.secondary }]}>No runs yet.</Text>
        ) : (
          runs.map((r) => <Row key={r.id} title={r.title ?? r.id} preview={r.preview ?? ''} onPress={() => {}} />)
        )}
        <GlassDialog
          visible={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={`Delete ${job?.name ?? 'this task'}?`}
          message="This will remove its schedule and prevent future runs."
          confirmLabel="Delete task"
          onConfirm={() => {
            setConfirmDelete(false);
            void mutate('remove', 'delete').then(() => router.replace('/(tabs)/tasks'));
          }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  meta: { fontSize: fontSize.body },
  label: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});

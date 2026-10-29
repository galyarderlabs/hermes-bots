import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { Row } from '../../src/components/Row';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { RowSkeleton } from '../../src/components/glassyui/GlassSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import { taskSections, jobKey, normalizeCronJob } from '../../src/lib/cron-state';
import type { CronJob } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

function Section({ title, jobs }: { title: string; jobs: CronJob[] }) {
  const { palette } = useTheme();
  if (jobs.length === 0) return null;
  return (
    <View>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {jobs.map((j) => (
        <Row
          key={jobKey(j) ?? j.name}
          title={j.name ?? jobKey(j) ?? 'Scheduled task'}
          preview={j.prompt_preview ?? j.prompt ?? ''}
          badge={`${j.schedule ?? ''}${j.next_run_at ? ` · next ${j.next_run_at}` : ''}`}
          onPress={() => router.push(`/tasks/${encodeURIComponent(jobKey(j) ?? '')}`)}
        />
      ))}
    </View>
  );
}

export default function TasksTab() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gateway) {
      // No gateway (unpaired or disconnected): do not strand the tab on
      // skeletons forever — show the empty state instead.
      setLoading(false);
      return;
    }
    let alive = true;
    gateway
      .cronList()
      .then((res) => {
        const raw = (res as { jobs?: unknown[] }).jobs ?? [];
        const list = raw.map((r) => normalizeCronJob(r as Record<string, unknown>)).filter((j): j is CronJob => j !== null);
        if (alive) setJobs(list);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [gateway]);

  const sections = taskSections(jobs);
  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Tasks</Text>
        <GlassButton title="New task" variant="prominent" onPress={() => router.push('/tasks/new')} />
      </View>
      {loading ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : jobs.length === 0 ? (
        <EmptyState message="No scheduled tasks — Scheduled jobs created in Hermes Desktop will appear here." actionLabel="Create a task" onAction={() => router.push('/tasks/new')} />
      ) : (
        <>
          <Section title="Running" jobs={sections.running} />
          <Section title="Scheduled" jobs={sections.scheduled} />
          <Section title="Paused — needs attention" jobs={sections.pausedAttention} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: '600' },
  sectionTitle: { fontSize: fontSize.title, fontWeight: '600', paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm },
});

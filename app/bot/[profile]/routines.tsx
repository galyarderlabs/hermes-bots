import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/theme/theme-context';
import { useConnection } from '../../../src/lib/connection-store';
import { Row } from '../../../src/components/Row';
import { GlassButton } from '../../../src/components/glassyui/GlassButton';
import { EmptyState } from '../../../src/components/EmptyState';
import { jobKey, normalizeCronJob } from '../../../src/lib/cron-state';
import type { CronJob } from '../../../src/lib/types';
import { fontSize, spacing } from '../../../src/theme/tokens';

export default function BotRoutinesScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [jobs, setJobs] = useState<CronJob[]>([]);

  useEffect(() => {
    if (!gateway) return;
    gateway
      .cronList(profile)
      .then((res) => {
        const raw = (res as { jobs?: unknown[] }).jobs ?? [];
        setJobs(raw.map((r) => normalizeCronJob(r as Record<string, unknown>)).filter((j): j is CronJob => j !== null));
      })
      .catch(() => {});
  }, [gateway, profile]);

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Routines for {profile}</Text>
        <GlassButton title="New task for this bot" variant="prominent" onPress={() => router.push('/tasks/new')} />
      </View>
      {jobs.length === 0 ? (
        <EmptyState message="No routines for this bot yet." actionLabel="Create a task" onAction={() => router.push('/tasks/new')} />
      ) : (
        jobs.map((j) => (
          <Row key={jobKey(j) ?? j.name} title={j.name ?? jobKey(j) ?? 'Task'} preview={j.prompt_preview ?? j.prompt ?? ''} badge={j.schedule ?? ''} onPress={() => router.push(`/tasks/${encodeURIComponent(jobKey(j) ?? '')}`)} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
});

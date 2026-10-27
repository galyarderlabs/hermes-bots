import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { useRoster } from '../../src/lib/use-roster';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassSegmentedControl } from '../../src/components/glassyui/GlassSegmentedControl';
import type { AutomationBlueprint, CronDeliveryTarget } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

// Create via blueprint or custom cron expression. Blueprint fields render
// from the host's field descriptors (enum/text/time/weekdays, help text,
// defaults). deliver defaults to bot-chat:{profile}.
export default function NewTaskScreen() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const { profiles } = useRoster(false);
  const [mode, setMode] = useState<'Blueprint' | 'Custom'>('Custom');
  const [profile, setProfile] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState('');
  const [blueprints, setBlueprints] = useState<AutomationBlueprint[]>([]);
  const [blueprintKey, setBlueprintKey] = useState('');
  const [targets, setTargets] = useState<CronDeliveryTarget[]>([]);
  const [deliver, setDeliver] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gateway) return;
    gateway.cronBlueprints().then((res) => setBlueprints((res as { blueprints?: AutomationBlueprint[] }).blueprints ?? [])).catch(() => {});
    gateway.cronDeliveryTargets().then((res) => setTargets((res as { targets?: CronDeliveryTarget[] }).targets ?? [])).catch(() => {});
  }, [gateway]);

  const create = async () => {
    if (!gateway || !profile || !prompt.trim()) return;
    try {
      if (mode === 'Blueprint' && blueprintKey) {
        await gateway.cronInstantiateBlueprint({ blueprint: blueprintKey, prompt: prompt.trim(), profile }, profile);
      }
      const res = (await gateway.cronCreate(
        {
          prompt: prompt.trim(),
          schedule: schedule || undefined,
          deliver: deliver || `bot-chat:${profile}`,
          profile,
        },
        profile,
      )) as { job_id?: string; id?: string };
      const id = res.job_id ?? res.id;
      if (id) router.replace(`/tasks/${encodeURIComponent(id)}`);
      else router.replace('/(tabs)/tasks');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create this task.');
    }
  };

  const blueprint = blueprints.find((b) => b.key === blueprintKey);

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>New task</Text>
        <GlassSegmentedControl options={['Blueprint', 'Custom'] as const} value={mode} onChange={setMode} accessibilityLabel="Task creation mode" />
        <GlassInput label="Bot" value={profile} onChangeText={setProfile} placeholder="Bot profile name" />
        {mode === 'Blueprint' ? (
          <>
            {blueprints.map((b) => (
              <GlassButton key={b.key} title={`${b.title} — ${b.description}`} variant={blueprintKey === b.key ? 'prominent' : 'soft'} onPress={() => setBlueprintKey(b.key)} />
            ))}
            {blueprint?.fields.map((f) => (
              <GlassInput key={f.name} label={f.label} placeholder={f.help} defaultValue={f.default ?? ''} />
            ))}
          </>
        ) : (
          <>
            <GlassInput label="Prompt" value={prompt} onChangeText={setPrompt} placeholder="What should Hermes do?" multiline numberOfLines={4} />
            <GlassInput label="Schedule" value={schedule} onChangeText={setSchedule} placeholder="Cron expression, or “every hour”, “weekdays at 9am”" />
            <GlassInput label="Deliver to" value={deliver} onChangeText={setDeliver} placeholder={`bot-chat:${profile || 'profile'}`} />
            {targets.map((t) => (
              <GlassButton key={t.id} title={t.name} variant={deliver === t.id ? 'prominent' : 'soft'} onPress={() => setDeliver(t.id)} />
            ))}
          </>
        )}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        <GlassButton title="Create task" variant="prominent" disabled={!profile || !prompt.trim()} onPress={() => void create()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
});

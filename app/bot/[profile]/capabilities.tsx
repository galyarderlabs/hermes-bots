import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/theme/theme-context';
import { useConnection } from '../../../src/lib/connection-store';
import { CapabilityRow } from '../../../src/components/CapabilityRow';
import { GlassInput } from '../../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../../src/components/glassyui/GlassAlert';
import type { Capability, ProfileDetails } from '../../../src/lib/types';
import { fontSize, spacing } from '../../../src/theme/tokens';

// Capabilities: at-least-one-toolset rule — disabling all toolsets is
// blocked with the explanation (an empty selection restores host defaults).
// Swallowed ok:false / applied:false is treated as failure, never success.
// Hub install requires installed === true.
export default function CapabilitiesScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [skills, setSkills] = useState<Capability[]>([]);
  const [toolsets, setToolsets] = useState<Capability[]>([]);
  const [query, setQuery] = useState('');
  const [hubResults, setHubResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    if (!gateway) return;
    const d = (await gateway.request('profiles.describe', { name: profile })) as ProfileDetails;
    setSkills(d.skills ?? []);
    setToolsets(d.toolsets ?? []);
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load capabilities.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, profile]);

  const save = async (nextSkills: Capability[], nextToolsets: Capability[]) => {
    if (!gateway) return;
    if (nextToolsets.length > 0 && nextToolsets.every((t) => !t.enabled)) {
      setError('At least one toolset must stay enabled — an empty selection restores host defaults.');
      return;
    }
    try {
      const res = (await gateway.request('profiles.configure', {
        name: profile,
        disabled_skills: nextSkills.filter((s) => !s.enabled).map((s) => s.name),
        enabled_toolsets: nextToolsets.filter((t) => t.enabled).map((t) => t.name),
      })) as { ok?: boolean; applied?: Record<string, boolean> };
      if (res.ok === false || Object.values(res.applied ?? {}).some((v) => v === false)) {
        throw new Error('Hermes reported the capability change was not applied.');
      }
      setNotice('Capabilities saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save capabilities.');
    }
  };

  const toggle = (list: Capability[], setList: (c: Capability[]) => void, name: string, enabled: boolean, other: Capability[]) => {
    const next = list.map((c) => (c.name === name ? { ...c, enabled } : c));
    setList(next);
    if (list === toolsets) void save(skills, next);
    else void save(next, other);
  };

  const searchHub = async () => {
    if (!gateway || !query.trim()) return;
    const res = (await gateway.request('skills.manage', { action: 'search', profile, query: query.trim() })) as { results?: { name?: string }[] };
    setHubResults((res.results ?? []).map((r) => r.name ?? ''));
  };

  const install = async (name: string) => {
    if (!gateway) return;
    const res = (await gateway.request('skills.manage', { action: 'install', profile, query: name })) as { installed?: boolean };
    if (res.installed !== true) {
      setError(`Skill ${name} was not installed (host did not confirm installed).`);
      return;
    }
    setNotice(`Skill ${name} installed.`);
    await load();
  };

  const enabledToolsets = toolsets.filter((t) => t.enabled).length;
  const enabledSkills = skills.filter((s) => s.enabled).length;

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Capabilities</Text>
        <Text style={[styles.counts, { color: palette.secondary }]}>{enabledToolsets} toolsets enabled · {enabledSkills} skills enabled</Text>
        {error ? <GlassAlert tone="error" message={error} /> : null}
        {notice ? <GlassAlert tone="success" message={notice} /> : null}
        <Text style={[styles.label, { color: palette.text }]}>Toolsets</Text>
        {toolsets.map((t) => (
          <CapabilityRow key={t.name} capability={t} onToggle={(v) => toggle(toolsets, setToolsets, t.name, v, skills)} />
        ))}
        <Text style={[styles.label, { color: palette.text }]}>Skills</Text>
        {skills.map((s) => (
          <CapabilityRow key={s.name} capability={s} onToggle={(v) => toggle(skills, setSkills, s.name, v, toolsets)} />
        ))}
        <Text style={[styles.label, { color: palette.text }]}>Skill hub</Text>
        <GlassInput value={query} onChangeText={setQuery} placeholder="Search skills" accessibilityLabel="Search skills" />
        <GlassButton title="Search hub" variant="primary" onPress={() => void searchHub()} />
        {hubResults.map((r) => (
          <View key={r} style={styles.hubRow}>
            <Text style={[styles.hubName, { color: palette.text }]}>{r}</Text>
            <GlassButton title="Install" variant="prominent" onPress={() => void install(r)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  counts: { fontSize: fontSize.body },
  label: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.lg },
  hubRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  hubName: { fontSize: fontSize.body },
});

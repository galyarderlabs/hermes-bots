import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassSegmentedControl } from '../../src/components/glassyui/GlassSegmentedControl';
import { canonicalSessionId } from '../../src/lib/roster';
import { fontSize, spacing } from '../../src/theme/tokens';

// Wizard: role -> identity -> SOUL -> model -> appearance.
// Creates the Bot, then opens its canonical chat immediately — never
// lands back on the roster with no chat to open.
const ROLES = ['Researcher', 'Coder', 'Writer', 'Analyst', 'Custom'] as const;

export default function NewBotWizard() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<(typeof ROLES)[number]>('Researcher');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [soul, setSoul] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [shape, setShape] = useState('blobatar');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = ['Role', 'Identity', 'SOUL', 'Model', 'Appearance'];
  const finish = async () => {
    if (!gateway || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await gateway.request('profiles.create', {
        name: name.trim(),
        description,
        soul,
        model: model || undefined,
        provider: provider || undefined,
        mirror_credentials: true,
        share_auth: true,
        clone_all: false,
        no_skills: false,
      });
      const created = (await gateway.request('session.create', {
        profile: name.trim(),
        title: 'Bot Chat',
        hidden: true,
        follow_profile_config: true,
      })) as { session_id?: string; stored_session_id?: string };
      await gateway.request('session.title', { session_id: created.stored_session_id || created.session_id, title: 'Bot Chat' });
      const roster = (await gateway.request('profiles.list', { include_sessions: true })) as {
        profiles?: { name: string; canonical_session?: { id: string; resolved_id?: string } }[];
      };
      const mine = roster.profiles?.find((p) => p.name === name.trim());
      const chatId = canonicalSessionId(mine?.canonical_session) ?? created.stored_session_id ?? created.session_id;
      if (chatId) router.replace(`/chat/${encodeURIComponent(chatId)}`);
      else router.replace('/(tabs)/bots');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create this bot.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.step, { color: palette.secondary }]}>Step {step + 1} of {steps.length}: {steps[step]}</Text>
        {step === 0 && <GlassSegmentedControl options={ROLES} value={role} onChange={setRole} accessibilityLabel="Bot role" />}
        {step === 1 && (
          <>
            <GlassInput label="Bot name" value={name} onChangeText={setName} placeholder="Bot name" />
            <GlassInput label="Description" value={description} onChangeText={setDescription} placeholder="What this bot does" />
          </>
        )}
        {step === 2 && (
          <>
            <GlassInput label="SOUL draft" value={soul} onChangeText={setSoul} placeholder="How this bot should behave" multiline numberOfLines={6} />
            <Text style={[styles.hint, { color: palette.secondary }]}>Hermes injects the teammate-messaging protocol automatically — you do not need to hand-write it.</Text>
          </>
        )}
        {step === 3 && (
          <>
            <GlassInput label="Model (optional)" value={model} onChangeText={setModel} placeholder="Model id" />
            <GlassInput label="Provider (optional)" value={provider} onChangeText={setProvider} placeholder="Provider" />
          </>
        )}
        {step === 4 && <GlassInput label="Appearance shape" value={shape} onChangeText={setShape} placeholder="blobatar" />}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        <View style={styles.actions}>
          {step > 0 ? <GlassButton title="Back" variant="ghost" onPress={() => setStep(step - 1)} /> : null}
          <GlassButton title="Cancel" variant="ghost" onPress={() => router.back()} />
          {step < steps.length - 1 ? (
            <GlassButton title="Next" variant="primary" disabled={step === 1 && !name.trim()} onPress={() => setStep(step + 1)} />
          ) : (
            <GlassButton title="Create bot" variant="prominent" disabled={!name.trim() || busy} onPress={() => void finish()} />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg },
  step: { fontSize: fontSize.body },
  hint: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.3 },
  actions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
});

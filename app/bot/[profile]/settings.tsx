import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/theme/theme-context';
import { useConnection } from '../../../src/lib/connection-store';
import { GlassInput } from '../../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../../src/components/glassyui/GlassAlert';
import type { ModelProvider, ProfileDetails } from '../../../src/lib/types';
import { fontSize, spacing } from '../../../src/theme/tokens';

// Bot settings: description + SOUL editor (dirty tracking, Cancel/Save),
// Bot-default model picker (authenticated providers only), labelled
// separately from the per-chat session override set in the composer.
export default function BotSettingsScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [details, setDetails] = useState<ProfileDetails | null>(null);
  const [description, setDescription] = useState('');
  const [soul, setSoul] = useState('');
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!gateway) return;
    gateway
      .request('profiles.describe', { name: profile })
      .then((res) => {
        const d = res as ProfileDetails;
        setDetails(d);
        setDescription(d.description ?? '');
        setSoul(d.soul ?? '');
        setSelectedModel(d.model?.default ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load bot settings.'));
    gateway
      .fetchModelOptions(profile)
      .then((res) => {
        const list = (res as { providers?: ModelProvider[] }).providers ?? [];
        // Authenticated providers only in the picker.
        setProviders(list.filter((p) => p.authenticated !== false));
      })
      .catch(() => {});
  }, [gateway, profile]);

  const save = async () => {
    if (!gateway) return;
    try {
      const res = (await gateway.request('profiles.configure', {
        name: profile,
        description,
        soul,
        ...(selectedModel ? { model: selectedModel } : {}),
      })) as { ok?: boolean; applied?: Record<string, boolean>; confirm_required?: boolean; confirm_message?: string };
      if (res.ok === false || Object.values(res.applied ?? {}).some((v) => v === false)) {
        throw new Error('Hermes reported the change was not applied. Nothing was saved.');
      }
      if (res.confirm_required) {
        setError(res.confirm_message ?? 'This change needs confirmation in Hermes Desktop.');
        return;
      }
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save bot settings.');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.handle, { color: palette.secondary }]}>@{profile}</Text>
        <Text style={[styles.title, { color: palette.text }]}>{details?.name ?? profile}</Text>
        <GlassInput label="Description" value={description} onChangeText={(t) => { setDescription(t); setDirty(true); }} multiline />
        <GlassInput label="SOUL" value={soul} onChangeText={(t) => { setSoul(t); setDirty(true); }} multiline numberOfLines={8} />
        <Text style={[styles.hint, { color: palette.secondary }]}>Hermes injects the teammate-messaging protocol automatically.</Text>
        <Text style={[styles.label, { color: palette.text }]}>Bot-default model</Text>
        {providers.length === 0 ? (
          <Text style={[styles.hint, { color: palette.secondary }]}>No authenticated providers returned by the host.</Text>
        ) : (
          providers.flatMap((p) => (p.models ?? p.featured_models ?? []).map((m) => (
            <GlassButton key={`${p.slug}:${m}`} title={`${p.name} · ${m}`} variant={selectedModel === m ? 'prominent' : 'soft'} onPress={() => { setSelectedModel(m); setDirty(true); }} />
          )))
        )}
        <Text style={[styles.hint, { color: palette.secondary }]}>Session override — set in the composer. Using this Bot’s default model unless overridden there.</Text>
        {error ? <GlassAlert tone="error" message={error} /> : null}
        {saved ? <GlassAlert tone="success" message="Changes saved." /> : null}
        {dirty ? (
          <View style={styles.actions}>
            <GlassButton title="Cancel" variant="ghost" onPress={() => { setDescription(details?.description ?? ''); setSoul(details?.soul ?? ''); setDirty(false); }} />
            <GlassButton title="Save changes" variant="prominent" onPress={() => void save()} />
          </View>
        ) : null}
        <Link href={`/bot/${encodeURIComponent(profile)}/capabilities`} asChild>
          <GlassButton title="Open capabilities" variant="primary" onPress={() => {}} />
        </Link>
        <Link href={`/bot/${encodeURIComponent(profile)}/routines`} asChild>
          <GlassButton title="Open routines" variant="primary" onPress={() => {}} />
        </Link>
        <Link href={`/bot/${encodeURIComponent(profile)}/computer`} asChild>
          <GlassButton title="Open computer" variant="primary" onPress={() => {}} />
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  handle: { fontSize: fontSize.body },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  label: { fontSize: fontSize.body, fontWeight: '600' },
  hint: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.3 },
  actions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
});

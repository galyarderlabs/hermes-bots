import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../src/theme/theme-context';
import { useRoster } from '../../src/lib/use-roster';
import { GlassSwitch } from '../../src/components/glassyui/GlassSwitch';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from '../../src/lib/notifications';
import { fontSize, spacing } from '../../src/theme/tokens';

// Quiet hours default 22:00–07:00 suppress ALERTS only, never progress.
// Per-bot include list: empty = all bots.
export default function NotificationsScreen() {
  const { palette } = useTheme();
  const { profiles } = useRoster(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [permissionNote, setPermissionNote] = useState(false);

  const toggleBot = (name: string, on: boolean) => {
    setPrefs((prev) => ({
      ...prev,
      includeProfiles: on ? [...prev.includeProfiles, name] : prev.includeProfiles.filter((p) => p !== name),
    }));
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Notifications</Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Notifications enabled</Text>
          <GlassSwitch value={prefs.enabled} onValueChange={(v) => setPrefs((p) => ({ ...p, enabled: v }))} accessibilityLabel="Notifications enabled" />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Alert when a bot finishes</Text>
          <GlassSwitch value={prefs.alertOnFinish} onValueChange={(v) => setPrefs((p) => ({ ...p, alertOnFinish: v }))} accessibilityLabel="Alert when a bot finishes" />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Quiet hours (suppress alerts only)</Text>
          <GlassSwitch value={prefs.quietHours.enabled} onValueChange={(v) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, enabled: v } }))} accessibilityLabel="Quiet hours enabled" />
        </View>
        <GlassInput label="Quiet hours start (hour, 0–23)" value={String(prefs.quietHours.startHour)} onChangeText={(t) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, startHour: Number(t) || 22 } }))} keyboardType="number-pad" />
        <GlassInput label="Quiet hours end (hour, 0–23)" value={String(prefs.quietHours.endHour)} onChangeText={(t) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, endHour: Number(t) || 7 } }))} keyboardType="number-pad" />
        <Text style={[styles.hint, { color: palette.secondary }]}>Default quiet hours are 22:00–07:00. Quiet hours never stop progress — only alerts.</Text>
        <Text style={[styles.label, { color: palette.text }]}>Per-bot alerts (empty selection = all bots)</Text>
        {profiles.map((p) => {
          const included = prefs.includeProfiles.length === 0 || prefs.includeProfiles.includes(p.name);
          return (
            <View key={p.name} style={styles.row}>
              <Text style={[styles.label, { color: palette.text }]}>{p.display_name ?? p.name}</Text>
              <GlassSwitch
                value={included}
                onValueChange={(v) => {
                  // Toggling one bot on from "all" narrows the list to that bot.
                  if (prefs.includeProfiles.length === 0 && !v) setPrefs((prev) => ({ ...prev, includeProfiles: profiles.filter((x) => x.name !== p.name).map((x) => x.name) }));
                  else toggleBot(p.name, v);
                }}
                accessibilityLabel={`Alerts for ${p.display_name ?? p.name}`}
              />
            </View>
          );
        })}
        <Text style={[styles.hint, { color: palette.secondary }]}>
          If notifications are off in system settings, in-app toggles stay visible but inert — open OS settings to re-enable. After granting permission, return here to re-sync.
        </Text>
        {permissionNote ? null : <Text style={[styles.hint, { color: palette.secondary }]} onPress={() => setPermissionNote(true)}>Notification permission is managed in system settings.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: { fontSize: fontSize.body },
  hint: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.3 },
});

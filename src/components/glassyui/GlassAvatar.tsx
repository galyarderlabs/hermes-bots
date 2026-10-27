// Photo with coloured-initials fallback; initials show until the photo
// loads — never a blank circle. Status dot always carries a text label
// elsewhere in the row (status is never colour alone).
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme/theme-context';
import { fontSize } from '../../theme/tokens';

export type Presence = 'online' | 'away' | 'busy' | 'offline';

export function GlassAvatar({
  name,
  image,
  size = 40,
  status,
}: {
  name: string;
  image?: string | null;
  size?: number;
  status?: Presence;
}) {
  const { palette } = useTheme();
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const dot = status === 'online' ? palette.jade : status === 'away' ? palette.gold : status === 'busy' ? palette.rose : palette.gray;
  return (
    <View style={{ width: size, height: size }}>
      {image ? (
        <Image source={{ uri: image }} style={[styles.img, { width: size, height: size, borderRadius: size / 2 }]} contentFit="cover" />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.accent }]}>
          <Text style={[styles.initials, { fontSize: size * 0.36, color: palette.onAccent }]}>{initials || '?'}</Text>
        </View>
      )}
      {status ? (
        <View
          accessibilityLabel={`Status: ${status}`}
          style={[styles.dot, { backgroundColor: dot, borderColor: palette.bg, width: size * 0.3, height: size * 0.3, borderRadius: size * 0.15 }]}
        />
      ) : null}
    </View>
  );
}

export function GlassAvatarGroup({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <View style={styles.group}>
      {shown.map((n, i) => (
        <View key={n} style={{ marginLeft: i === 0 ? 0 : -10 }}>
          <GlassAvatar name={n} size={32} />
        </View>
      ))}
      {names.length > max ? <GlassAvatar name={`+${names.length - max}`} size={32} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  img: {},
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '600' },
  dot: { position: 'absolute', bottom: 0, right: 0, borderWidth: 2 },
  group: { flexDirection: 'row', alignItems: 'center' },
});

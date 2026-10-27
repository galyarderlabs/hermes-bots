// Skeleton for content that will arrive, shaped like what replaces it.
// Skeletons, not spinners, for content loads.
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { radius, spacing } from '../../theme/tokens';

export function GlassSkeleton({ width = '100%', height = 16, borderRadius = radius.card }: { width?: number | string; height?: number; borderRadius?: number }) {
  const { palette } = useTheme();
  return <View accessibilityLabel="Loading" aria-busy style={[styles.box, { width, height, borderRadius, backgroundColor: palette.tile, opacity: 0.7 }]} />;
}

export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <GlassSkeleton width={40} height={40} borderRadius={20} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <GlassSkeleton width="60%" height={16} />
        <GlassSkeleton width="90%" height={14} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {},
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, alignItems: 'center' },
});

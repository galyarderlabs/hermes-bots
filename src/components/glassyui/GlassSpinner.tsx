// Short indeterminate waits only (send indicator, connection check).
// Never a full-screen loader for content — that is a skeleton's job.
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';

export function GlassSpinner({ label = 'Loading' }: { label?: string }) {
  const { palette } = useTheme();
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={palette.accent} />
    </View>
  );
}

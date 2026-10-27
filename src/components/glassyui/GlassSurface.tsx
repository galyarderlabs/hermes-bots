// The material primitive. On native, glass = tinted surface + optional blur.
// Without a GlassBackdrop on Android, or under reduced transparency, this
// renders as its opaque tile fallback — by design, not as degradation.
import type { ReactNode } from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme/theme-context';
import { radius } from '../../theme/tokens';
import { useGlassBackdrop } from './GlassBackdrop';

export function GlassSurface({
  children,
  borderRadius = radius.card,
  style,
  ...props
}: ViewProps & { children: ReactNode; borderRadius?: number }) {
  const { palette, reduceTransparency, dark } = useTheme();
  const hasBackdrop = useGlassBackdrop();
  const useBlur = !reduceTransparency && (Platform.OS === 'ios' || hasBackdrop);
  return (
    <View
      {...props}
      style={[{ backgroundColor: palette.tile, borderRadius, overflow: 'hidden' }, style]}
    >
      {useBlur ? (
        <BlurView intensity={60} tint={dark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
      ) : null}
      {children}
    </View>
  );
}

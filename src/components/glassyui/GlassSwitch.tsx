import { Switch } from 'react-native';
import { useTheme } from '../../theme/theme-context';

export function GlassSwitch({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel: string;
}) {
  const { palette } = useTheme();
  return <Switch value={value} onValueChange={onValueChange} accessibilityLabel={accessibilityLabel} trackColor={{ true: palette.switchOn, false: palette.border }} thumbColor={palette.onAccent} />;
}

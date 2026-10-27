// Theme resolution: System / Dark / Light, persisted per device.
// Default is System. Resolved before first paint via the root layout's
// splash handling; glass collapses to opaque tile under Reduce Transparency.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './tokens';

export type ThemeChoice = 'system' | 'dark' | 'light';

interface ThemeCtx {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
  palette: Palette;
  dark: boolean;
  reduceTransparency: boolean;
  setReduceTransparency: (v: boolean) => void;
  reduceMotion: boolean;
  setReduceMotion: (v: boolean) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children, initialChoice = 'system' }: { children: ReactNode; initialChoice?: ThemeChoice }) {
  const system = useColorScheme();
  const [choice, setChoice] = useState<ThemeChoice>(initialChoice);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const dark = choice === 'dark' || (choice === 'system' && system === 'dark');
  const value = useMemo<ThemeCtx>(
    () => ({ choice, setChoice, palette: dark ? darkPalette : lightPalette, dark, reduceTransparency, setReduceTransparency, reduceMotion, setReduceMotion }),
    [choice, dark, reduceTransparency, reduceMotion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

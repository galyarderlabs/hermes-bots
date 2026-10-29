// Design tokens — the ONLY file in the app that may contain raw hex.
// Source: analysis/design-contract.md §3.1 (glassyui site/library tokens).
// Dark is default; light is an equal second appearance.
// Contrast gate (binding): light jade #14a874 on light bg is 2.90:1 —
// it must NEVER be used as text. Dot/badge fill only, paired with dark ink.

export type Appearance = 'dark' | 'light' | 'system';

export interface Palette {
  bg: string;
  tile: string;
  text: string;
  secondary: string;
  tertiary: string;
  link: string;
  accent: string;
  prominentFill: string;
  focusRing: string;
  invalid: string;
  switchOn: string;
  border: string;
  jade: string;
  gold: string;
  rose: string;
  violet: string;
  gray: string;
  onAccent: string;
  // Badge fills: jade/gold/rose used as FILL only, never as text.
  // Badge text is always dark ink on a tinted fill (see GlassBadge).
  badgeInk: string;
}

export const darkPalette: Palette = {
  bg: '#1c1c1e',
  tile: '#2c2c2e',
  text: '#f5f5f7',
  secondary: '#b8b8be',
  tertiary: '#a8a8af',
  link: '#78b7ff',
  accent: '#0067d9',
  prominentFill: '#0067d9',
  focusRing: '#b8b8be',
  invalid: '#ff7a8e',
  switchOn: '#0067d9',
  border: '#3a3a3e',
  jade: '#33d69f',
  gold: '#ffbd38',
  rose: '#ff5c7a',
  violet: '#9b80ff',
  gray: '#8e8e93',
  badgeInk: '#1c1c1e',
  onAccent: '#ffffff',
};

export const lightPalette: Palette = {
  bg: '#faf9f7',
  tile: '#ffffff',
  text: '#222224',
  secondary: '#66666a',
  tertiary: '#66666a',
  link: '#005ec6',
  accent: '#0067d9',
  prominentFill: '#0067d9',
  focusRing: '#66666a',
  invalid: '#c4153f',
  switchOn: '#0067d9',
  border: '#e2e0dc',
  jade: '#14a874',
  gold: '#e8960c',
  rose: '#e8345a',
  violet: '#6a4cf0',
  gray: '#8e8e93',
  badgeInk: '#1c1c1e',
  onAccent: '#ffffff',
};

// Board brand colors (GBots flow board, light theme). These live here
// because tokens.ts is the only file allowed raw color literals.
// Board-sampled approximations, adjustable: button blue, wordmark navy,
// tagline slate, frosted secondary button, icon tile.
export const brand = {
  blue: '#2563eb',
  navy: '#0a1e4e',
  tagline: '#55688a',
  glass: 'rgba(255,255,255,0.6)',
  glassBorder: 'rgba(255,255,255,0.85)',
  iconBg: '#dbeafe',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = {
  capsule: 999,
  card: 20,
  sheet: 24,
  dialog: 24,
  composer: 24,
  fieldExpanded: 16,
  avatar: 999,
  bubble: 20,
  bubbleTail: 6,
  toast: 12,
  badge: 999,
} as const;

// System fonts only. No bundled font, no brand font.
export const fontFamily = { system: undefined as string | undefined, mono: 'monospace' } as const;

export const fontSize = {
  display: 32,
  headline: 28,
  title: 20,
  body: 17,
  bodyStrong: 17,
  secondary: 15,
  caption: 14,
  metadata: 12,
  minimum: 11,
} as const;

export const minTouch = 44;

export function paletteFor(appearance: 'dark' | 'light'): Palette {
  return appearance === 'dark' ? darkPalette : lightPalette;
}

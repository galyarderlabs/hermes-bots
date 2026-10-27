// Brief background outcomes only ("Task created", "Bot deleted — Undo").
// "Message sent" is NOT a toast — it is visible in the thread.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const Ctx = createContext<{ showToast: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function useToast(): { showToast: (t: Omit<Toast, 'id'>) => void } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside GlassToastProvider');
  return ctx;
}

export function GlassToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <GlassToastViewport toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
    </Ctx.Provider>
  );
}

export function GlassToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const { palette } = useTheme();
  if (toasts.length === 0) return null;
  return (
    <View style={styles.viewport} pointerEvents="box-none">
      {toasts.map((t) => (
        <View key={t.id} accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: palette.tile, borderColor: palette.border }]}>
          <Text style={[styles.message, { color: palette.text }]}>{t.message}</Text>
          {t.actionLabel ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.actionLabel} onPress={() => { t.onAction?.(); onDismiss(t.id); }} style={styles.action}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>{t.actionLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => onDismiss(t.id)} style={styles.action}>
            <Text style={{ color: palette.secondary }}>Dismiss</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { position: 'absolute', bottom: 90, left: 16, right: 16, gap: 8 },
  toast: { borderRadius: radius.toast, borderWidth: 1, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  message: { flex: 1, fontSize: fontSize.body },
  action: { minHeight: 44, justifyContent: 'center' },
});

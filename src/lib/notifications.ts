// Notification preferences (port-spec §4.7, F18).
// Quiet hours suppress ALERTS only — never progress state.
// Per-bot include list: empty = all bots.
import type { NotificationPreferences } from './types';

export type { NotificationPreferences };

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  includeProfiles: [],
  alertOnFinish: true,
  quietHours: { enabled: true, startHour: 22, endHour: 7 },
};

export function isQuietHour(prefs: NotificationPreferences, now = new Date()): boolean {
  if (!prefs.quietHours.enabled) return false;
  const h = now.getHours();
  const { startHour, endHour } = prefs.quietHours;
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour; // overnight span, e.g. 22:00–07:00
}

export function shouldAlert(prefs: NotificationPreferences, profile: string, now = new Date()): boolean {
  if (!prefs.enabled || !prefs.alertOnFinish) return false;
  if (isQuietHour(prefs, now)) return false;
  if (prefs.includeProfiles.length > 0 && !prefs.includeProfiles.includes(profile)) return false;
  return true;
}

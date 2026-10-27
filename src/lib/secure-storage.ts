// Thin wrapper over Expo SecureStore (iOS Keychain / Android Keystore).
// ONLY device credentials live here. Turn journal, host lists and prefs
// use AsyncStorage via their own modules — never this store.
import * as SecureStore from 'expo-secure-store';

export async function saveCredential(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function getCredential(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function deleteCredential(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

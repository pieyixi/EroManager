export interface AccountInfo {
  key: number;
  id: string;
  nickname: string;
  avatar: string;
  has_pin: boolean;
}
export interface AccountState {
  accounts: AccountInfo[];
  current: AccountInfo | null;
  last_id: string;
  scope: string;
  locked: boolean;
}
export interface PrivacySettings {
  idle_seconds: number;
  background_seconds: number;
  minimize: boolean;
  system: boolean;
  while_playing: boolean;
}
export const defaultPrivacy = (): PrivacySettings => ({ idle_seconds: 0, background_seconds: 0, minimize: false, system: true, while_playing: false });
export const idleLockSeconds = [0, 60, 300, 900, 1800, 3600] as const;
export const backgroundLockSeconds = [0, 1, 300, 600, 1800] as const;
export function normalizePrivacy(value: Partial<PrivacySettings>): PrivacySettings {
  const result = { ...defaultPrivacy(), ...value };
  if (!idleLockSeconds.some(seconds => seconds === result.idle_seconds)) result.idle_seconds = 0;
  if (!backgroundLockSeconds.some(seconds => seconds === result.background_seconds)) result.background_seconds = 0;
  return result;
}

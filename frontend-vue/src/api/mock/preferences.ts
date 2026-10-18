import { defaultPreferences, type UserPreferences, type WorkRecord } from '../contracts/preferences';
const preferenceKey = 'ero-browser-preferences-v1';
const recordsKey = 'ero-browser-work-records-v1';
function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}
export const mockPreferences = {
  get: () => ({ ...defaultPreferences(), ...read<Partial<UserPreferences>>(preferenceKey, {}) }),
  set: (preferences: UserPreferences) => { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); return preferences; },
  getRecord: (kind: string, id: number) => read<Record<string, WorkRecord>>(recordsKey, {})[`${kind}:${id}`] || null,
  setRecord: (record: WorkRecord) => {
    const records = read<Record<string, WorkRecord>>(recordsKey, {});
    records[`${record.kind}:${record.content_id}`] = record;
    localStorage.setItem(recordsKey, JSON.stringify(records));
  },
};

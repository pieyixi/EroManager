import { accountScope, trackAccountWrite } from '../accountContext';
import { invokeTauri } from '../tauri';
import type { ApplicationInfo, UserPreferences, WorkRecord } from '../contracts/preferences';
const writes = new Map<string, Promise<void>>();
export async function flushWorkRecords(): Promise<void> { await Promise.all([...writes.values()]); }
function setWorkRecord(record: WorkRecord): Promise<void> {
  const scope = accountScope();
  const key = `${scope}:${record.kind}:${record.content_id}`;
  const request = (writes.get(key) || Promise.resolve()).catch(() => undefined)
    .then(() => invokeTauri<void>('set_work_record', { scope, record }));
  writes.set(key, request);
  void request.finally(() => { if (writes.get(key) === request) writes.delete(key); }).catch(() => undefined);
  return request;
}
export const preferencesApi = {
  get: () => invokeTauri<UserPreferences>('get_user_preferences', { scope: accountScope() }),
  set: (preferences: UserPreferences) => trackAccountWrite(invokeTauri<UserPreferences>('set_user_preferences', { scope: accountScope(), preferences })),
  getRecord: (kind: WorkRecord['kind'], contentId: number) => invokeTauri<WorkRecord | null>('get_work_record', { scope: accountScope(), kind, contentId }),
  setRecord: setWorkRecord,
  info: () => invokeTauri<ApplicationInfo>('get_application_info'),
};

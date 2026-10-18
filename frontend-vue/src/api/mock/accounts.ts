import { defaultPreferences, type UserPreferences, type WorkRecord } from '../contracts/preferences';
import type { AccountInfo, AccountState } from '../contracts/accounts';
import { mockPreferences } from './preferences';

interface Entry extends AccountInfo { disabled?: boolean; salt?: string; hash?: string }
interface Data { accounts: Entry[]; last: number; values: Record<string, Record<string, string>> }
const storageKey = 'ero-browser-accounts-v1';
let current: number | null = null, token = '', initialized = false, failures = 0, blocked = 0;
function load(): Data {
  const raw = localStorage.getItem(storageKey);
  if (raw) return JSON.parse(raw) as Data;
  const value: Data = { accounts: [{ key: 2, id: '0001', nickname: '本地资料库', avatar: '', has_pin: false }], last: 2,
    values: { '2': { 'preferences:': JSON.stringify(mockPreferences.get()) } } };
  localStorage.setItem(storageKey, JSON.stringify(value)); return value;
}
const save = (data: Data) => localStorage.setItem(storageKey, JSON.stringify(data));
function authorize(scope: unknown): number {
  if (!scope || scope !== token || current === null) throw Error('账号已锁定或已切换，请重新进入');
  return current;
}
function snapshot(): AccountState {
  const data = load();
  const accounts = data.accounts.filter(a => a.id !== '0000' && !a.disabled).map(({ key, id, nickname, avatar, has_pin }) => ({ key, id, nickname, avatar, has_pin }));
  const selected = accounts.find(a => a.key === current) || null;
  return { accounts, current: selected, last_id: selected?.id || '', scope: token, locked: !token };
}
async function digest(pin: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120000 }, material, 256);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
function activeEntry(data: Data): Entry { const entry = data.accounts.find(a => a.key === current); if (!entry) throw Error('账号不存在'); return entry; }
function read(scope: unknown, kind: string, item: string): string | null { return load().values[String(authorize(scope))]?.[`${kind}:${item}`] || null; }
function write(scope: unknown, kind: string, item: string, value: string): void {
  const data = load(), key = String(authorize(scope)); (data.values[key] ||= {})[`${kind}:${item}`] = value; save(data);
}
export const mockAccounts = {
  state(): AccountState {
    if (!initialized) { const data = load(); const last = data.accounts.find(a => a.key === data.last && !a.disabled && a.id !== '0000') || data.accounts.find(a => !a.disabled && a.id !== '0000'); current = last?.key || null; token = last && !last.has_pin ? crypto.randomUUID() : ''; initialized = true; }
    return snapshot();
  },
  async auth(id: string, pin: string): Promise<AccountState> {
    if (Date.now() < blocked) throw Error(`尝试过多，请 ${Math.ceil((blocked - Date.now()) / 1000)} 秒后再试`);
    const data = load(), entry = data.accounts.find(a => a.id === id && id !== '0000' && !a.disabled);
    if (!entry || (entry.has_pin ? !/^\d{4}$/.test(pin) || await digest(pin, entry.salt || '') !== entry.hash : !!pin)) {
      if (++failures >= 5) { blocked = Date.now() + 30000; failures = 0; throw Error('尝试过多，请 30 秒后再试'); } throw Error('账号不可用或 PIN 不正确');
    }
    failures = 0; current = entry.key; token = crypto.randomUUID(); data.last = current; save(data); return snapshot();
  },
  lock(): void { token = ''; },
  logout(): void { token = ''; current = null; },
  async pin(scope: unknown, newPin: string): Promise<void> {
    authorize(scope); const data = load(), entry = activeEntry(data);
    if (newPin && !/^\d{4}$/.test(newPin)) throw Error('PIN 必须为四位数字');
    entry.has_pin = !!newPin; entry.salt = crypto.randomUUID(); entry.hash = newPin ? await digest(newPin, entry.salt) : ''; save(data);
  },
  profile(scope: unknown, nickname: string, avatar: string): void {
    authorize(scope); if (!nickname.trim() || nickname.length > 24) throw Error('昵称应为1至24个字符');
    if (avatar && (!avatar.startsWith('data:image/png;base64,') || avatar.length > 2800000)) throw Error('头像格式无效');
    const data = load(), entry = activeEntry(data); entry.nickname = nickname.trim(); entry.avatar = avatar; save(data);
  },
  get: read,
  set: write,
  preferences(scope: unknown): UserPreferences {
    const defaults = defaultPreferences(), global = mockPreferences.get();
    const values = scope && scope === token ? JSON.parse(read(scope, 'preferences', '') || '{}') as Partial<UserPreferences> : {};
    return { ...defaults, ...values, close_action: global.close_action, close_prompt: global.close_prompt };
  },
  savePreferences(scope: unknown, value: UserPreferences): UserPreferences {
    if (scope) write(scope, 'preferences', '', JSON.stringify(value));
    mockPreferences.set({ ...mockPreferences.get(), close_action: value.close_action, close_prompt: value.close_prompt }); return value;
  },
  getRecord(scope: unknown, kind: string, id: number): WorkRecord | null { return JSON.parse(read(scope, 'record', `${kind}:${id}`) || 'null'); },
  setRecord(scope: unknown, record: WorkRecord): void { write(scope, 'record', `${record.kind}:${record.content_id}`, JSON.stringify(record)); },
  favorites(scope: unknown, kind: string): string[] { if (!scope || scope !== token) return []; return Object.keys(load().values[String(authorize(scope))] || {}).filter(key => key.startsWith(`${kind}:`)).map(key => key.slice(kind.length + 1)).sort(); },
  favorite(scope: unknown, kind: string, item: string, favorite: boolean): void {
    if (favorite) write(scope, kind, item, 'true');
    else { const data = load(); delete (data.values[String(authorize(scope))] || {})[`${kind}:${item}`]; save(data); }
  },
};

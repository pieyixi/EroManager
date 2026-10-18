import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
const set = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../api/commands/accounts', () => ({ accountApi: { set } }));
import { useAccountsStore } from './accounts';
describe('privacy settings updates', () => {
  it('does not lose earlier toggles when several saves overlap', async () => {
    setActivePinia(createPinia()); const store = useAccountsStore();
    let finish!: () => void;
    set.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = store.savePrivacy({ minimize: true });
    await store.savePrivacy({ while_playing: true }); finish(); await first;
    expect(store.privacy.minimize).toBe(true); expect(store.privacy.while_playing).toBe(true);
  });
});

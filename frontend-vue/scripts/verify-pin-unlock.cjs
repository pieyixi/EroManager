const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:1422/?preview=settings');
    await page.locator('.startup-screen').waitFor({ state: 'detached' });
    await page.waitForTimeout(1300);
    await page.evaluate(async () => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const { accountApi } = await import('/src/api/commands/accounts.ts');
      await accountApi.pin('2468'); stores.get('profile').hasPin = true; stores.get('accounts').current.has_pin = true;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      canvas.getContext('2d').fillRect(0, 0, 512, 512);
      await stores.get('profile').setAvatar(canvas.toDataURL('image/png'));
      const { preferencesApi } = await import('/src/api/commands/preferences.ts');
      await preferencesApi.setRecord({ kind: 'book', content_id: -123, position: 17, pair_offset: 1, merged_pairs: ['2:3', '4:5'] });
      await stores.get('accounts').savePrivacy({ idle_seconds: 300, minimize: true });
    });
    const savedAvatar = await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('profile').avatar);
    // A private editor must close on lock and must not reappear after unlocking.
    await page.getByRole('button', { name: '编辑账号', exact: true }).click();
    await page.keyboard.press('Control+Shift+L'); await locked();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '四位 PIN');
    assert.equal(await page.getByRole('dialog', { name: '账号资料', exact: true }).count(), 0);
    const field = page.getByRole('textbox', { name: '四位 PIN', exact: true });
    await field.fill('12'); assert.equal(await page.locator('.pin-digit.on').count(), 2);
    await field.press('Escape'); assert.equal(await page.locator('.pin-digit.on').count(), 0);
    await field.fill('a2b4'); assert.equal(await field.inputValue(), '24'); await field.press('Escape');
    // The reference's demo password must have no special meaning.
    await field.fill('8888'); await page.locator('.pin.err').waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'ero-pin-error-frame.png') });
    await ready(); assert.equal(await page.locator('.account-curtain').count(), 1);
    for (let attempt = 1; attempt < 5; attempt++) { await field.fill('0000'); await ready(); }
    await page.locator('.pin.cool').waitFor();
    assert.match(await page.locator('.pin-cooldown').innerText(), /秒后再试/);
    assert(await field.getAttribute('readonly') !== null);
    await page.screenshot({ path: path.join(os.tmpdir(), 'ero-pin-cooldown.png') });
    // Use real time: jumping the browser clock deliberately triggers the resume privacy boundary.
    await page.waitForFunction(() => !document.querySelector('.pin-field').readOnly, null, { timeout: 35000 }); await ready();
    await field.fill('2468'); await page.locator('.pin.ok').waitFor();
    assert(await page.locator('.window').evaluate(element => element.inert));
    await page.locator('.account-curtain').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('dialog', { name: '账号资料', exact: true }).count(), 0);
    await page.reload(); await page.locator('.startup-screen').waitFor({ state: 'detached' }); await locked();
    await page.getByRole('textbox', { name: '四位 PIN', exact: true }).fill('2468');
    await page.locator('.pin.ok').waitFor();
    const opening = await page.locator('#page-home .home-draw-flipper').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationPlayState));
    assert(opening.length > 0); assert(opening.every(value => value === 'paused'));
    await page.locator('.account-curtain').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.window').evaluate(element => element.inert), false);
    const persisted = await page.evaluate(async () => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const { preferencesApi } = await import('/src/api/commands/preferences.ts');
      return { avatar: stores.get('profile').avatar, privacy: stores.get('accounts').privacy, record: await preferencesApi.getRecord('book', -123) };
    });
    assert.equal(persisted.avatar, savedAvatar); assert.equal(persisted.privacy.idle_seconds, 300); assert(persisted.privacy.minimize);
    assert.equal(persisted.record.position, 17); assert.deepEqual(persisted.record.merged_pairs, ['2:3', '4:5']);
    // The lock screen's close action remains available above the privacy curtain.
    await page.keyboard.press('Control+Shift+L'); await locked();
    await page.locator('.account-chrome').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('dialog', { name: '点击关闭按钮以后', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS PIN reference: dot/digit morph, Esc/filtering, demo PIN rejection, staggered failure, backend cooldown, success handoff; persistent avatar/privacy/signed reading record; editor interruption and closing while locked');
    async function locked() { await page.getByRole('dialog', { name: '隐私锁', exact: true }).waitFor(); await page.waitForFunction(() => !document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('accounts').busy); }
    async function ready() { await page.waitForFunction(() => { const pin = document.querySelector('.pin'); return pin && pin.getAttribute('aria-busy') === 'false'; }); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch(); let cases = 0;
  try {
    for (const [width, height] of [[1920,1080],[1366,768],[1280,720]]) for (const theme of ['light','dark']) for (const reducedMotion of ['no-preference','reduce']) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(theme => localStorage.setItem('ero-browser-accounts-v1', JSON.stringify({ accounts: [
        { key: 2, id: '0001', nickname: '有 PIN 的账号', avatar: '', has_pin: false },
        { key: 3, id: '0002', nickname: '无 PIN 的账号', avatar: '', has_pin: false },
      ], last: 2, values: { 2: { 'preferences:': JSON.stringify({ theme }) }, 3: { 'preferences:': JSON.stringify({ theme }) } } })), theme);
      await page.goto('http://127.0.0.1:1422/?preview=settings'); await page.locator('.startup-screen').waitFor({ state: 'detached' });
      await page.waitForTimeout(1200);
      await page.evaluate(async () => {
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const { accountApi } = await import('/src/api/commands/accounts.ts'); await accountApi.pin('1234');
        stores.get('profile').hasPin = true; stores.get('accounts').current.has_pin = true;
      });
      assert.equal(await page.locator('.account-settings').getByRole('button', { name: '立即锁定', exact: true }).count(), 0);
      await page.getByRole('button', { name: '切换或退出账号', exact: true }).click();
      const menu = page.getByRole('menu', { name: '账号操作' });
      assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['切换账号','立即锁定','退出登录']);
      assert.equal(await menu.getByRole('menuitem', { name: '立即锁定' }).evaluate(e => getComputedStyle(e).color), await menu.getByRole('menuitem', { name: '切换账号' }).evaluate(e => getComputedStyle(e).color));
      assert.equal(await menu.getByRole('menuitem', { name: '立即锁定' }).locator('svg rect').count(), 1);
      await page.screenshot({ path: path.join(os.tmpdir(), `ero-account-menu-new-${width}-${theme}.png`) });
      await menu.getByRole('menuitem', { name: '立即锁定' }).click(); await page.getByRole('textbox', { name: '四位 PIN', exact: true }).waitFor();
      await page.waitForFunction(() => !document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('accounts').busy); await page.waitForTimeout(400);
      await page.getByRole('textbox', { name: '四位 PIN', exact: true }).fill('9999'); await page.locator('.pin.err').waitFor();
      assert.equal(await page.locator('.account-error').count(), 0); await ready();
      await motion('选择其他账号', 240);
      await motion('使用 ID 进入', 380);
      assert.equal(await page.locator('.account-id-input,.account-enter,.account-unlock h2').count(), 0);
      const id = page.getByRole('textbox', { name: '账号 ID', exact: true });
      await id.fill('0001'); await page.waitForTimeout(250);
      assert.equal(await page.getByRole('textbox', { name: '四位 PIN', exact: true }).count(), 0, 'ID requires Enter instead of submitting on the fourth digit');
      assert.equal(await page.locator('.pin-digit.on').count(), 4);
      await page.screenshot({ path: path.join(os.tmpdir(), `ero-account-id-new-${width}-${theme}.png`) });
      await id.press('Enter'); await page.getByRole('textbox', { name: '四位 PIN', exact: true }).waitFor();
      await page.getByRole('textbox', { name: '四位 PIN', exact: true }).fill('1234'); await page.locator('.account-curtain').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '切换或退出账号', exact: true }).click(); await page.getByRole('menuitem', { name: '立即锁定', exact: true }).click();
      await ready(); await page.waitForTimeout(400);
      // Reverse a brand flight before it reaches its small endpoint.
      await page.getByRole('button', { name: '选择其他账号', exact: true }).evaluate(e => e.click()); await page.waitForTimeout(85);
      const before = await page.locator('.account-brand-visual').boundingBox();
      await motion('使用 ID 进入', 380, false);
      assert(before.width > 240 && before.width < 380);
      await page.getByRole('textbox', { name: '账号 ID', exact: true }).fill('0002'); await page.waitForTimeout(250);
      assert.equal(await page.locator('.account-curtain').count(), 1);
      await page.getByRole('textbox', { name: '账号 ID', exact: true }).press('Enter'); await page.locator('.account-curtain').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('profile').id), '0002');
      // Accounts without a PIN must retain a working curtain dismissal path.
      await page.keyboard.press('Control+Shift+L'); await page.getByRole('button', { name: '进入 无 PIN 的账号 0002', exact: true }).waitFor();
      await page.waitForFunction(() => !document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('accounts').busy);
      await page.getByRole('button', { name: '进入 无 PIN 的账号 0002', exact: true }).click(); await page.locator('.account-curtain').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []); await page.close(); cases++;

      async function ready() { await page.waitForFunction(() => { const input = document.querySelector('.pin-field'); return input && !input.readOnly; }); }
      async function motion(label, targetWidth, save = true) {
        const framesPromise = page.evaluate(async label => {
          const brand = document.querySelector('.account-brand-visual');
          const sample = () => { const r = brand.getBoundingClientRect(); return { time: performance.now(), x: r.x, y: r.y, width: r.width, height: r.height, textureWidth: brand.offsetWidth, textureHeight: brand.offsetHeight, contentOpacity: [...document.querySelectorAll('.account-content-slot>.account-unlock,.account-content-slot>.account-choices')].reduce((sum, element) => sum + Number(getComputedStyle(element).opacity), 0) }; };
          const frames = [sample()]; [...document.querySelectorAll('.account-text-button')].find(e => e.textContent === label).click();
          const start = performance.now();
          while (performance.now() - start < 680) { await new Promise(requestAnimationFrame); frames.push(sample()); }
          return frames;
        }, label);
        if (save) { await page.waitForTimeout(140); await page.screenshot({ path: path.join(os.tmpdir(), `ero-account-brand-mid-${width}-${theme}-${targetWidth}.png`) }); }
        const frames = await framesPromise;
        assert(Math.abs(frames.at(-1).width - targetWidth) < .2);
        assert(frames.every(frame => frame.textureWidth === 380 && frame.textureHeight === 290), 'Brand texture stays at fixed size throughout the flight');
        assert(frames.every(frame => frame.contentOpacity > .93), 'Content crossfade must not dim to a blank intermediate state');
        const direction = Math.sign(targetWidth - frames[0].width);
        for (let i = 1; i < frames.length; i++) {
          assert(direction * (frames[i].width - frames[i - 1].width) >= -.3, `Brand scale reversed at frame ${i}`);
          assert(Math.abs(frames[i].width - frames[i - 1].width) / Math.max(16, frames[i].time - frames[i - 1].time) < 1.3, `Brand jumped at frame ${i} (${reducedMotion})`);
        }
        assert(frames.some(frame => Math.abs(frame.width - frames[0].width) > 2 && Math.abs(frame.width - targetWidth) > 2), 'Must show intermediate scales, not a jump');
        const settled = await page.locator('.account-brand-visual').boundingBox();
        assert(Math.abs(settled.y - frames.at(-1).y) < .3 && Math.abs(settled.width - frames.at(-1).width) < .3, 'No endpoint jump after animation cleanup');
      }
    }
    console.log(`PASS ${cases} gate layout suites: normal/reduced OS animation preference, continuous early frames and opaque crossfades, shared four-dot ID/Enter and PIN/auto submit, silent failure, constant-texture brand motion both directions/interruption, menu lock placement/color/operation, no-PIN curtain return`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

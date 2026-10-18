import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');

describe('product identity and rename compatibility', () => {
  it('uses the exact approved display name in browser and native windows', () => {
    const config = JSON.parse(read('src-tauri/tauri.conf.json'));
    expect(config.productName).toBe('裏界箱庭');
    expect(config.app.windows[0].title).toBe('裏界箱庭');
    expect(read('frontend-vue/index.html')).toContain('<title>裏界箱庭</title>');
  });
  it('keeps Rust binary/library names and the executable entry point aligned', () => {
    const cargo = read('src-tauri/Cargo.toml');
    expect(cargo).toMatch(/\[package\]\s+name = "ero-manager"/);
    expect(cargo).toMatch(/\[lib\]\s+name = "ero_manager_lib"/);
    expect(read('src-tauri/src/main.rs')).toContain('ero_manager_lib::run()');
    expect(read('src-tauri/Cargo.lock')).toContain('name = "ero-manager"');
    expect(read('src-tauri/Cargo.lock')).not.toContain('name = "hanime-manager"');
  });
  it('aligns frontend package identity without upgrading dependencies', () => {
    const pkg = JSON.parse(read('frontend-vue/package.json'));
    const lock = JSON.parse(read('frontend-vue/package-lock.json'));
    expect(pkg.name).toBe('ero-manager-frontend');
    expect(lock.name).toBe(pkg.name); expect(lock.packages[''].name).toBe(pkg.name);
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
  });
  it('preserves WebView, marker and backup identities independently of database layout', () => {
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).identifier).toBe('com.hanime.manager');
    expect(read('src-tauri/src/library/portable.rs')).toContain('".hanime-library.json"');
    expect(read('src-tauri/src/library/backup.rs')).toContain('"_hanime_manager/database.db"');
  });
});

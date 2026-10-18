import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(root, '..');
const pairs = [
  ['src/api/contracts/accounts.ts', 'AccountInfo', 'src-tauri/src/accounts/commands.rs', 'AccountInfo'],
  ['src/api/contracts/accounts.ts', 'AccountState', 'src-tauri/src/accounts/commands.rs', 'AccountState'],
  ['src/api/contracts/preferences.ts', 'UserPreferences', 'src-tauri/src/settings.rs', 'UserPreferences'],
  ['src/api/contracts/preferences.ts', 'WorkRecord', 'src-tauri/src/settings.rs', 'WorkRecord'],
  ['src/api/contracts/preferences.ts', 'ApplicationInfo', 'src-tauri/src/settings.rs', 'ApplicationInfo'],
  ['src/api/contracts/library.ts', 'TagSummary', 'src-tauri/src/library/models.rs', 'Tag'],
  ['src/api/contracts/library.ts', 'WorkSummary', 'src-tauri/src/library/models.rs', 'WorkWithTags'],
  ['src/api/contracts/library.ts', 'WorkDetail', 'src-tauri/src/library/models.rs', 'WorkDetail'],
  ['src/api/contracts/library.ts', 'LibrarySummary', 'src-tauri/src/library/models.rs', 'LibraryConsoleSummary'],
  ['src/api/contracts/library.ts', 'ConsoleItem', 'src-tauri/src/library/models.rs', 'LibraryConsoleItem'],
  ['src/api/contracts/library.ts', 'LibraryScan', 'src-tauri/src/library/models.rs', 'LibraryConsoleScanResult'],
  ['src/api/contracts/library.ts', 'DuplicateItem', 'src-tauri/src/library/models.rs', 'DuplicateItem'],
  ['src/api/contracts/library.ts', 'DuplicateGroup', 'src-tauri/src/library/models.rs', 'DuplicateGroup'],
  ['src/api/contracts/archive.ts', 'ArchiveEpisodeTags', 'src-tauri/src/library/models.rs', 'ArchiveEpisodeTags'],
  ['src/api/contracts/archive.ts', 'ArchiveEpisode', 'src-tauri/src/library/models.rs', 'ArchiveEpisodeDraft'],
  ['src/api/contracts/archive.ts', 'ArchiveDraft', 'src-tauri/src/library/models.rs', 'ArchiveDraft'],
  ['src/api/contracts/eh.ts', 'EhGallerySummary', 'src-tauri/src/eh/models.rs', 'EhGallerySummary'],
  ['src/api/contracts/eh.ts', 'EhReaderPage', 'src-tauri/src/eh/models.rs', 'EhReaderPageInfo'],
  ['src/api/contracts/eh.ts', 'EhDownloadFailure', 'src-tauri/src/eh/models.rs', 'EhDownloadFailure'],
  ['src/api/contracts/eh.ts', 'EhDownloadResult', 'src-tauri/src/eh/models.rs', 'EhDownloadResult'],
];

function block(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`${marker} 缺少结束括号`);
}

function tsFields(file, name) {
  const body = block(readFileSync(resolve(root, file), 'utf8'), `interface ${name} {`);
  const fields = new Map();
  for (const match of body.matchAll(/^\s*([A-Za-z0-9_]+)(\?)?\s*:/gm)) fields.set(match[1], !match[2]);
  return fields;
}

function rustFields(file, name) {
  const body = block(readFileSync(resolve(repo, file), 'utf8'), `struct ${name} {`);
  const fields = new Map();
  for (const match of body.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?([a-z][a-z0-9_]*)\s*:/gm)) fields.set(match[1], true);
  return fields;
}

const errors = [];
for (const [tsFile, tsName, rustFile, rustName] of pairs) {
  const ts = tsFields(tsFile, tsName);
  const rust = rustFields(rustFile, rustName);
  const missing = [...rust.keys()].filter((field) => !ts.has(field));
  const extra = [...ts.keys()].filter((field) => !rust.has(field));
  const optional = [...rust.keys()].filter((field) => ts.get(field) === false);
  if (missing.length || extra.length || optional.length) {
    errors.push(`${tsName} ↔ ${rustName}: 缺少[${missing}] 多余[${extra}] 错误可选[${optional}]`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Response DTO contract verified: ${pairs.length} pairs.`);

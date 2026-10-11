import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const contract = JSON.parse(readFileSync(resolve(root, 'scripts', 'architecture-contract.json'), 'utf8'));
const enforce = process.argv.includes('--enforce');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|vue|css)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const metricPatterns = {
  globalBridgeReferences: [
    /\bglobalFunction\s*\(/g,
    /\blegacyFunction\s*\(/g,
    /\bcallLegacy\s*\(/g,
    /\binstall[A-Z]\w*Globals\s*\(/g,
    /window\s+as\s+typeof\s+window\s*&/g,
  ],
  domQueries: [
    /\bgetElementById(?:<[^>]+>)?\s*\(/g,
    /\bquerySelector(?:All)?(?:<[^>]+>)?\s*\(/g,
  ],
  htmlWrites: [
    /\.innerHTML\s*=/g,
    /\.outerHTML\s*=/g,
    /\.insertAdjacentHTML\s*\(/g,
  ],
};

const boundaryPatterns = {
  rawInvokeOutsideApi: /\binvokeTauri(?:<[^)]*>)?\s*\(/g,
  apiStoreDependencies: /from\s+['"][^'"]*stores\//g,
  storeDomWrites: /\b(?:document|window\.document)\s*\./g,
};

function countMatches(source, patterns) {
  return patterns.reduce((total, pattern) => total + [...source.matchAll(pattern)].length, 0);
}

const rows = sourceFiles(sourceRoot).map((path) => {
  const source = readFileSync(path, 'utf8');
  const metrics = Object.fromEntries(Object.entries(metricPatterns).map(([name, patterns]) => [name, countMatches(source, patterns)]));
  const file = relative(root, path).replaceAll('\\', '/');
  const boundaryMetrics = {
    rawInvokeOutsideApi: file.startsWith('src/api/') || file === 'src/features/player/mpv.ts'
      ? 0
      : countMatches(source, [boundaryPatterns.rawInvokeOutsideApi]),
    apiStoreDependencies: file.startsWith('src/api/') ? countMatches(source, [boundaryPatterns.apiStoreDependencies]) : 0,
    storeDomWrites: file.startsWith('src/stores/') ? countMatches(source, [boundaryPatterns.storeDomWrites]) : 0,
  };
  return { file, ...metrics, ...boundaryMetrics, lines: source.split(/\r?\n/).length, bytes: Buffer.byteLength(source) };
});

const totals = Object.fromEntries([...Object.keys(metricPatterns), ...Object.keys(boundaryPatterns)].map((name) => [
  name,
  rows.reduce((total, row) => total + row[name], 0),
]));

const activeRows = rows.filter((row) => Object.keys(metricPatterns).some((name) => row[name] > 0));
console.table(activeRows);
console.log('Architecture migration metrics:', totals);
console.log('Final target:', contract.finalTarget);

const sizeContract = contract.fileSize || { maxLines: 500, maxBytes: 60000, allowlist: {} };
const largeFiles = rows.filter((row) => row.lines > sizeContract.maxLines || row.bytes > sizeContract.maxBytes);
if (largeFiles.length) {
  console.table(largeFiles.map(({ file, lines, bytes }) => ({ file, lines, bytes, allowlisted: Boolean(sizeContract.allowlist[file]) })));
  const unallowlisted = largeFiles.filter(({ file }) => !sizeContract.allowlist[file]);
  if (unallowlisted.length && enforce) {
    throw new Error(`Large-file contract requires a boundary or explicit allowlist: ${unallowlisted.map(({ file }) => file).join(', ')}`);
  }
}

if (enforce) {
  const failures = Object.entries(contract.currentMaximum)
    .filter(([name, maximum]) => totals[name] > maximum)
    .map(([name, maximum]) => `${name}: ${totals[name]} exceeds ${maximum}`);
  if (failures.length) throw new Error(`Architecture contract regressed:\n${failures.join('\n')}`);
}

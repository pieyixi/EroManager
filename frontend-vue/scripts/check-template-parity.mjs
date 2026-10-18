import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(resolve(root, 'scripts', 'ui-contract.json'), 'utf8'));
// 页面和业务组件可以分目录；契约必须递归检查所有 Vue 模板，而非只看 components 根层。
function readTemplates(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? readTemplates(file) : entry.name.endsWith('.vue') ? [readFileSync(file, 'utf8')] : [];
  });
}
const componentHtml = readTemplates(resolve(root, 'src')).join('\n');

function readSourceTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return readSourceTree(path);
    return /\.(?:ts|vue)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
  }).join('\n');
}

const applicationSource = readSourceTree(resolve(root, 'src'));

function values(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]).sort();
}

function unique(valuesToDedupe) {
  return [...new Set(valuesToDedupe)].sort();
}

function compare(label, expected, actual) {
  const missing = expected.filter((value) => !actual.includes(value));
  const added = actual.filter((value) => !expected.includes(value));
  if (!missing.length && !added.length) return;

  const details = [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    added.length ? `added: ${added.join(', ')}` : '',
  ].filter(Boolean).join('\n  ');
  throw new Error(`${label} differs from the UI contract\n  ${details}`);
}

const componentIds = unique(values(componentHtml, /(?:^|\s)(?:id|jump-input-id)="([^"]+)"/gm));
compare('DOM ids', contract.ids.slice().sort(), componentIds);

const handlerPattern = /\bon(?:click|input|focus|blur|keydown|mouseenter|mouseleave|pointerdown|pointermove|pointerup|pointercancel|pointerleave)="([^"]+)"/g;
const componentHandlers = unique(values(componentHtml, handlerPattern));
if (componentHandlers.length) throw new Error(`Inline handlers are forbidden in Vue templates: ${componentHandlers.join(', ')}`);
const generatedInlineHandlers = unique(values(applicationSource, /\bon(?:click|input|focus|blur|keydown|contextmenu|error|mouseenter|mouseleave|pointerdown|pointermove|pointerup|pointercancel|pointerleave)=\\?"([^"\n]+)"/g));
if (generatedInlineHandlers.length) throw new Error(`Inline handlers are forbidden in generated markup: ${generatedInlineHandlers.join(', ')}`);

const requiredPages = contract.pages;
compare('Page roots', requiredPages.slice().sort(), componentIds.filter((id) => id.startsWith('page-')));

console.log(`Vue UI contract verified: ${componentIds.length} ids; no inline handlers.`);

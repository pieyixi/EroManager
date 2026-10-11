import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const commandDir = resolve(root, 'src', 'api', 'commands');
const rustSourceDir = resolve(root, '..', 'src-tauri', 'src');
const rustRuntime = readFileSync(resolve(rustSourceDir, 'runtime.rs'), 'utf8');
const mock = readFileSync(resolve(root, 'src', 'api', 'webMock.ts'), 'utf8');

function files(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path, extension) : path.endsWith(extension) ? [path] : [];
  });
}

function balanced(source, start, open, close, quoteCharacters = '"\'`') {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (quoteCharacters.includes(char)) {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close && --depth === 0) return { content: source.slice(start + 1, index), end: index + 1 };
  }
  throw new Error(`Unbalanced ${open}${close} expression`);
}

function splitTopLevel(source) {
  const parts = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  const stack = [];
  const pairs = { '(': ')', '[': ']', '{': '}', '<': '>' };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (pairs[char]) stack.push(pairs[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (char === ',' && stack.length === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function objectKeys(expression, context) {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error(`${context} must pass a literal argument object`);
  return splitTopLevel(trimmed.slice(1, -1)).map((property) => {
    if (property.startsWith('...')) throw new Error(`${context} uses a spread argument`);
    const match = property.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (!match) throw new Error(`${context} has an unsupported argument property: ${property}`);
    return match[1];
  }).sort();
}

function typedCommands() {
  const commands = new Map();
  for (const path of files(commandDir, '.ts')) {
    const source = readFileSync(path, 'utf8');
    let cursor = 0;
    while ((cursor = source.indexOf('invokeTauri', cursor)) >= 0) {
      let callStart = cursor + 'invokeTauri'.length;
      while (/\s/.test(source[callStart])) callStart += 1;
      if (source[callStart] !== '<' && source[callStart] !== '(') {
        cursor = callStart;
        continue;
      }
      if (source[callStart] === '<') callStart = balanced(source, callStart, '<', '>').end;
      while (/\s/.test(source[callStart])) callStart += 1;
      if (source[callStart] !== '(') throw new Error(`Cannot parse invokeTauri in ${relative(root, path)}`);
      const call = balanced(source, callStart, '(', ')');
      const args = splitTopLevel(call.content);
      const name = args[0]?.match(/^['"]([a-z][a-z0-9_]+)['"]$/)?.[1];
      if (!name) throw new Error(`Typed command name must be a string literal in ${relative(root, path)}`);
      if (commands.has(name)) throw new Error(`Duplicate typed command wrapper: ${name}`);
      commands.set(name, args[1] ? objectKeys(args[1], name) : []);
      cursor = call.end;
    }
  }
  return commands;
}

function camelCase(value) {
  return value.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function rustCommands() {
  const commands = new Map();
  for (const path of files(rustSourceDir, '.rs')) {
    const source = readFileSync(path, 'utf8');
    const attribute = /#\[tauri::command(?:\([^\]]*\))?\]/g;
    for (const match of source.matchAll(attribute)) {
      const offset = match.index + match[0].length;
      const tail = source.slice(offset);
      const declaration = tail.match(/\bpub(?:\(crate\))?\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/);
      if (!declaration) throw new Error(`Cannot parse Tauri command after ${relative(root, path)}:${match.index}`);
      const name = declaration[1];
      const open = offset + declaration.index + declaration[0].lastIndexOf('(');
      const signature = balanced(source, open, '(', ')', '"').content;
      const args = splitTopLevel(signature).flatMap((parameter) => {
        const separator = parameter.indexOf(':');
        if (separator < 0) throw new Error(`Cannot parse Rust parameter for ${name}: ${parameter}`);
        const parameterName = parameter.slice(0, separator).trim().replace(/^mut\s+/, '');
        const type = parameter.slice(separator + 1).trim();
        if (/\bState\s*</.test(type) || /\b(?:AppHandle|Window|WebviewWindow)\b/.test(type)) return [];
        return [camelCase(parameterName)];
      }).sort();
      if (commands.has(name)) throw new Error(`Duplicate Rust Tauri command: ${name}`);
      commands.set(name, args);
    }
  }
  return commands;
}

function sorted(values) { return [...values].sort(); }
function missing(expected, actual) { return sorted(expected).filter((name) => !actual.has(name)); }
function extra(actual, expected) { return sorted(actual).filter((name) => !expected.has(name)); }

const typed = typedCommands();
const rustSignatures = rustCommands();
const rustBlock = rustRuntime.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] || '';
const registered = new Set([...rustBlock.matchAll(/(?:\b\w+::)*([A-Za-z_]\w*)\s*,/g)].map((match) => match[1]));
const mockBlock = mock.match(/const handlers:\s*Record<string, MockHandler>\s*=\s*\{([\s\S]*?)\n\};/)?.[1] || '';
const mocked = new Set([...mockBlock.matchAll(/^\s{2}([A-Za-z_]\w*)\s*:/gm)].map((match) => match[1]));
const typedNames = new Set(typed.keys());
const failures = [];

for (const [name, typedArgs] of typed) {
  const rustArgs = rustSignatures.get(name);
  if (rustArgs && JSON.stringify(typedArgs) !== JSON.stringify(rustArgs)) {
    failures.push(`${name} argument mismatch: typed [${typedArgs.join(', ')}], Rust [${rustArgs.join(', ')}]`);
  }
}
for (const [label, actual] of [['Rust registration', registered], ['Rust signatures', new Set(rustSignatures.keys())], ['Web Mock', mocked]]) {
  const missingNames = missing(typedNames, actual);
  const extraNames = extra(actual, typedNames);
  if (missingNames.length) failures.push(`${label} missing typed commands: ${missingNames.join(', ')}`);
  if (extraNames.length) failures.push(`${label} has commands without typed wrappers: ${extraNames.join(', ')}`);
}

console.log(`Command signatures: ${typed.size} typed; Rust ${rustSignatures.size}; registered ${registered.size}; mock ${mocked.size}.`);
if (failures.length) throw new Error(`Command contract mismatch:\n${failures.join('\n')}`);

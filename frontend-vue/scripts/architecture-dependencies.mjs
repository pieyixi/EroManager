import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

/** 页面只由应用装配；组件必须有明确领域归属，不再回流到平铺目录。 */
export function structureFailures(files) {
  return files.flatMap(file => {
    if (!file.endsWith('.vue')) return [];
    if (file.endsWith('Page.vue') && !file.startsWith('pages/')) return [`Page must live under pages/: ${file}`];
    if (file.startsWith('components/') && file.split('/').length < 3) return [`Component needs a responsibility directory: ${file}`];
    return [];
  });
}

/** 导入边界检查覆盖页面/业务组件/共享控件；type-only 边不参与运行时环检测。 */
export function dependencyFailures(edges) {
  const failures = [];
  for (const { from, to } of edges) {
    if (to.startsWith('pages/') && from !== 'App.vue') failures.push(`${from} must not import page ${to}`);
    if (from.startsWith('api/') && !to.startsWith('api/')) failures.push(`${from} must not depend on UI/state ${to}`);
    if (from.startsWith('features/') && /^(pages|components)\//.test(to)) failures.push(`${from} must not import rendering ${to}`);
    if (from.startsWith('stores/') && /^(pages|components)\//.test(to)) failures.push(`${from} must not import rendering ${to}`);
    if (from.startsWith('stores/') && /^features\/(shell\/|[^/]+\/use[A-Z])/.test(to)) failures.push(`${from} must not own UI composable ${to}`);
    if (from.startsWith('components/shared/') && !to.startsWith('components/shared/')) failures.push(`${from} must remain domain-independent, not depend on ${to}`);
    const domain = from.match(/^components\/([^/]+)\//)?.[1];
    const targetDomain = to.match(/^components\/([^/]+)\//)?.[1];
    if (domain && !['shared', 'shell'].includes(domain) && targetDomain && ![domain, 'shared'].includes(targetDomain)) failures.push(`${from} must not couple business rendering to ${to}`);
  }
  const graph = new Map();
  for (const edge of edges.filter(edge => !edge.typeOnly)) {
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    graph.get(edge.from).push(edge.to);
  }
  const visited = new Set(), active = new Set(), stack = [];
  function visit(node) {
    if (active.has(node)) { failures.push(`Runtime import cycle: ${[...stack.slice(stack.indexOf(node)), node].join(' -> ')}`); return; }
    if (visited.has(node)) return;
    active.add(node); stack.push(node);
    for (const next of graph.get(node) || []) visit(next);
    stack.pop(); active.delete(node); visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
  return failures;
}

export function moduleReferences(code, filename = 'module.ts') {
  const ast = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const references = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause, named = clause?.namedBindings;
      const typeOnly = !!clause?.isTypeOnly || (!clause?.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly));
      references.push({ specifier: node.moduleSpecifier.text, typeOnly: !!typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause;
      const typeOnly = node.isTypeOnly || (named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly));
      references.push({ specifier: node.moduleSpecifier.text, typeOnly: !!typeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
      references.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return references;
}

export function inspectDependencies(sourceRoot, files) {
  const edges = [];
  for (const file of files.filter(file => /\.(ts|vue)$/.test(file) && !file.endsWith('.d.ts'))) {
    let code = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) code = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
    for (const { specifier, typeOnly } of moduleReferences(code, file)) {
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.vue`, resolve(base, 'index.ts')].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      if (!target || !files.includes(target)) continue;
      edges.push({ from: relative(sourceRoot, file).replaceAll('\\', '/'), to: relative(sourceRoot, target).replaceAll('\\', '/'), typeOnly });
    }
  }
  const paths = files.map(file => relative(sourceRoot, file).replaceAll('\\', '/'));
  return { edges, failures: [...structureFailures(paths), ...dependencyFailures(edges)] };
}

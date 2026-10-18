import { describe, expect, it } from 'vitest';
import { dependencyFailures, moduleReferences, structureFailures } from './architecture-dependencies.mjs';

const edge = (from: string, to: string, typeOnly = false) => ({ from, to, typeOnly });
describe('frontend responsibility boundaries', () => {
  it('keeps route pages and domain components in their own directories', () => {
    expect(structureFailures(['pages/HomePage.vue', 'components/home/HomeDrawCard.vue', 'components/shared/WindowControls.vue'])).toEqual([]);
    expect(structureFailures(['components/HomePage.vue'])).toHaveLength(1);
    expect(structureFailures(['components/WindowControls.vue'])).toHaveLength(1);
    expect(structureFailures(['components/home/HomePage.vue'])).toHaveLength(1);
  });
  it('permits page composition, business components and typed state/API dependencies', () => {
    expect(dependencyFailures([
      edge('App.vue', 'pages/HomePage.vue'), edge('pages/HomePage.vue', 'components/home/HomeDrawCard.vue'),
      edge('components/home/HomeHandDeck.vue', 'features/home/useHandInteraction.ts'),
      edge('features/home/useHandInteraction.ts', 'stores/homeHand.ts'), edge('stores/home.ts', 'features/home/random.ts'),
      edge('stores/home.ts', 'api/commands/library.ts'), edge('components/shared/WindowControls.vue', 'components/shared/ShellBackButton.vue'),
    ])).toEqual([]);
  });
  it.each([
    edge('components/home/Card.vue', 'pages/HomePage.vue'), edge('features/home/random.ts', 'components/home/Card.vue'),
    edge('api/commands/library.ts', 'stores/library.ts'), edge('stores/library.ts', 'features/shell/useShellBrowse.ts'),
    edge('stores/home.ts', 'features/home/useHandLayout.ts'), edge('components/shared/WindowControls.vue', 'stores/navigation.ts'),
    edge('components/home/Card.vue', 'components/downloads/Lane.vue'),
  ])('rejects reversed ownership: $from → $to', (entry) => {
    expect(dependencyFailures([entry]).length).toBeGreaterThan(0);
  });
  it('detects runtime cycles while allowing type-only back references', () => {
    expect(dependencyFailures([edge('stores/a.ts', 'stores/b.ts'), edge('stores/b.ts', 'stores/a.ts')])).toHaveLength(1);
    expect(dependencyFailures([edge('stores/a.ts', 'stores/b.ts'), edge('stores/b.ts', 'stores/a.ts', true)])).toEqual([]);
  });
  it('covers re-exports, lazy imports and type-only edges without mistaking text for imports', () => {
    expect(moduleReferences(`
      import { type Model } from './model';
      import {} from './side-effect';
      export { controller } from './controller';
      export type { State } from './state';
      export { type View } from './view';
      async function start() { return import('./lazy'); }
      const text = "import('./not-an-import')";
    `)).toEqual([
      { specifier: './model', typeOnly: true }, { specifier: './side-effect', typeOnly: false },
      { specifier: './controller', typeOnly: false }, { specifier: './state', typeOnly: true },
      { specifier: './view', typeOnly: true }, { specifier: './lazy', typeOnly: false },
    ]);
  });
});

# Vue Frontend

This is the active Tauri frontend: Vue 3, TypeScript, Pinia and Vite. The archived frontend is not part of the build.

## Development

```powershell
npm install
npm run dev
npm run build
```

Tauri uses this directory through `src-tauri/tauri.conf.json`. A browser preview uses the typed development mock only when no Tauri runtime is present. Production always uses native commands and never loads mock library data.

## Structure

- `src/pages`: route-level pages, composed only by `App.vue`.
- `src/components/shell`: shared application chrome, sidebar, browse toolbar and overlays.
- `src/components/shared`: domain-independent window and back controls.
- `src/components/home` / `downloads`: business components owned by their domains.
- `src/features/shell`: UI search/filter and ordinary-window controllers.
- `src/features/home`, `reader`, `player`, `theme`: cohesive feature behavior and UI state machines.
- `src/stores`: Pinia shared state and business workflows; established store paths are retained.
- `src/api/contracts` / `commands`: typed backend contract and adapters.
- `src/runtime`: application lifetime and global event wiring.
- `src/assets/styles`: ordered shared styles plus domain styles; reader styling remains scoped.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, dependency direction and verification rules.

Browser development includes a default download showcase: eight cards per source covering queued, active, failed-page, failed-request and completed states. These snapshots are installed only by the development browser runtime, do not start a worker or write history, and the sample queue is removed before a manual download starts. Production bundles exclude the fixture modules.

Downloads run independent Eh and Hitomi FIFO workers, one active work per source. Both sources can run together without changing the existing per-work three-image parallelism, newest-first card order or credential-free history format.

## Compatibility and Validation

Structural cleanup preserves DOM identifiers, classes, text, CSS cascade, routes, source IDs, native command contracts and data formats. Gesture/animation state machines stay cohesive. Do not create generic layers or compatibility forwarding files merely to preserve old source paths.

`npm run build` runs the complete frontend gate: unit tests, architecture ownership/cycle checks, command and response parity, recursive template parity, strict Vue TypeScript and production bundling. Individual checks are also available through `npm run test`, `check:architecture`, `check:commands`, `check:responses` and `check:parity`.

For before/after layout checks use `scripts/verify-frontend-structure.cjs` as described in the architecture document. Native controls, filesystem operations and libmpv playback additionally require isolated Tauri verification. A successful build is not a production release.

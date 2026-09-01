# Vue Frontend

This directory is the active Tauri frontend. It uses Vue 3, TypeScript, and Vite.

Version 4.0 keeps Vue as the sole frontend runtime and adds the image-library and reader workflows behind the same typed Tauri command boundary. The previous HTML and JavaScript frontend is no longer part of the active build.

## Compatibility contract

- The existing DOM ids, class names, visible text, and shared CSS remain unchanged.
- Tauri commands and the Rust/libmpv backend are unchanged.
- Each existing page is now a Vue single-file component.
- Pinia stores own application state; feature modules own library and player behavior.
- `npm run check:parity` prevents accidental removal of the stable DOM contract and rejects inline HTML handlers.

## Commands

```powershell
npm install
npm run test
npm run build
npm run dev
```

Tauri runs these commands automatically through `src-tauri/tauri.conf.json`.

## Browser development

`npm run dev` can run directly in a normal browser without Cargo or a Tauri window. In Vite development mode, `src/api/tauri.ts` selects `src/api/webMock.ts` only when the Tauri runtime is absent. The mock provides representative library, detail, incomplete-entry, filter, pagination, and settings data for rapid UI work.

The adapter follows these boundaries:

- A real Tauri runtime always has priority and continues to call the Rust commands.
- Production builds never enable the browser mock.
- The mock implements backend response contracts, not duplicated business logic.
- Native window controls, libmpv playback, filesystem writes, and backup/restore still require Tauri integration testing.
- Unsupported native commands fail explicitly instead of pretending that an operation succeeded.

Use the browser for layout, responsive behavior, themes, animation, filtering, navigation, and data states. Use Tauri only for the final native integration pass.

## Structure

- `src/components`: Vue page components.
- `src/stores`: Pinia state and settings/archive workflows.
- `src/features/library`: media-library navigation, filters, detail rendering, and library actions.
- `src/features/player`: typed libmpv transport, native layout, thumbnail pipeline, and playback controller.
- `src/runtime`: startup wiring and application-level events.
- `scripts/ui-contract.json`: stable DOM ids used by CSS and native integration.
- `ARCHITECTURE.md`: final ownership rules, dependency direction, migration gates, and completion criteria.

## Validation

`npm run build` is the required frontend gate. It runs Vitest, enforces the current architecture ceiling, validates the UI contract, performs strict TypeScript checking, and builds the production bundle. Run `npm run audit:architecture` to inspect progress toward zero global bridges, DOM queries, and generated HTML writes. Native playback should additionally be checked in a Tauri window because the libmpv surface cannot be validated in a normal browser.

Keep visual changes separate from behavior changes so native playback regressions remain easy to isolate.

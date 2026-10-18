# ero-manager

A portable, local-first desktop application for organizing and reviewing a privately maintained media collection. Its display name is 裏界箱庭.

Local browsing, playback, and reading work offline. Optional source downloads require an internet connection. The application keeps its index beside the executable and does not require a hosted account service.

## Features

- Searchable and filterable library view
- Structured item and episode metadata
- Workspace for incomplete entries
- Embedded playback powered by libmpv
- Local cover and preview image management
- Library synchronization and duplicate checks
- Portable SQLite storage
- Manual backup tools

## Technology

- Tauri 2
- Rust
- SQLite
- Vue 3, TypeScript, Pinia, and Vite
- libmpv

## Version 5.2

Version 5.2 improves startup presentation, catalog statistics, profiles, and navigation while preserving portable local storage.

- Prepared first-page covers and initial home draws before revealing the main interface.
- Cached catalog-size statistics with coordinated loading placeholders.
- Local profiles, per-account preferences and favorites, optional four-digit PIN locks, and configurable lock boundaries.
- A separate keyboard-driven account-management terminal that can run alongside the application.
- Inline profile editing, circular avatar cropping, and expanded avatar previews.
- Shared cover transitions between catalogs, downloads, and details, with preserved return positions.
- Persistent draw-cycle history and consistent theme transitions.

## Version 5.1

Version 5.1 adds a dedicated discovery home and refines navigation, reading, and download presentation.

- Independent random draws for both catalogs, with no-replacement cycles and recent-repeat protection.
- Themed card transitions and aspect-ratio-aware previews.
- A session-only hand of saved draws, with drag collection, cyclic browsing, and temporary removal.
- Separate home and catalog navigation, plus a sidebar download shortcut that returns to its entry page.
- Mouse-wheel reader navigation and decoded page staging that keeps the current image visible until the next page is ready.
- Consistent download-card ordering, compact aligned forms, and cover-only detail navigation.
- Regression checks for interrupted carousel gestures, responsive layouts, reader presentation, and navigation return paths.

## Version 5.0

Version 5.0 improves download workflows, reader interactions, and maintainability while preserving the portable, local-first catalog.

- Dedicated two-source download page with a shared FIFO work queue and separate histories.
- Cover-based progress and status, bounded automatic retries, and incremental failed-page recovery.
- Validated image payloads, atomic file replacement, and guarded resume/deletion boundaries.
- Admission-time sorting that preserves scan history and brings completed downloads forward.
- Reader fullscreen controls, right-to-left progress, and mixed-DPI window-bound handling.
- Explicit Rust domain modules and typed frontend/backend contracts with automated parity checks.

- Vue single-file components define the page structure.
- Pinia stores own shared state and long-running workflows.
- Library and player behavior live in dedicated feature modules.
- The libmpv transport, native video layout, timeline preview pipeline, and playback session are isolated behind typed feature boundaries.
- Automated tests cover library filtering, pagination, indexing, incomplete-entry summaries, size formatting, player display rules, playlist transitions, and timeline preview planning.
- Architecture checks enforce zero global compatibility bridges, zero application DOM queries, and zero HTML string injection.
- A UI contract check protects stable element identifiers and rejects inline HTML event handlers.
- Shared shell controls keep navigation and window behavior consistent across library, detail, workspace, settings, and playback views.
- Native playback now preserves monitor placement, maximized state, fullscreen bounds, and media-handle cleanup more reliably.
- Independent local catalogs share the same navigation, search, filtering, detail, and settings conventions.
- The image reader supports single- and dual-page layouts, right-to-left navigation, zooming, keyboard controls, and progressive page loading.
- Embedded metadata localization improves display and search without replacing canonical source values.
- Visible-page cover loading and request deduplication keep first-page rendering responsive as catalogs grow.
- Destructive catalog actions distinguish database-only removal from guarded local-folder deletion.

## Project Layout

```text
frontend-vue/ Active Vue frontend
src-tauri/    Rust backend and desktop configuration
```

## Development

Check the Rust backend:

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```

Check and build the frontend:

```powershell
cd frontend-vue
npm install
npm run build
```

`npm run build` runs unit tests, architecture and command/response/UI contract checks, strict TypeScript validation, and the Vite production build.

Build the Windows release:

```powershell
npm --prefix frontend-vue run build
cargo build --release --manifest-path src-tauri\Cargo.toml
python frontend-vue\scripts\remove-admin-icon.py src-tauri\target\release\ero-manager-admin.exe
```

The portable package contains only `ero-manager.exe`, `ero-manager-admin.exe`, `lib/ero_manager_lib.dll`, `lib/libmpv-2.dll`, and `lib/libmpv-wrapper.dll`. Build output is not an installed update; back up the previous runtime and replace only these program files. Never overwrite an existing database or user-data folder. Both SQLite databases live under `db/` beside the executable.

Run `ero-manager-admin.exe` to manage local accounts. The first use asks you to set an administrator PIN; there is no default password. The terminal uses the Windows default executable icon and supports running alongside the main application.

Existing installations retain their application storage identifier, database names, library markers and backup-format identifiers for compatibility. Product renaming does not move or reset user data.

For the first renamed update, back up existing `hanime-manager.exe` and `hanime_manager_lib.dll` runtime files as well. Verify the new executable before retiring the legacy runtime. Optional native test overrides use `ERO_MPV_LIBRARY` and `ERO_TEST_VIDEO`; the former `HANIME_*` names remain accepted for compatibility.

## Data Policy

Personal databases, local media, generated backups, and release archives are excluded from source control. Runtime data should be backed up separately.

Metadata may include an optional top-level `search_aliases` string array. These aliases are imported into the portable index and used only for local search; the original title remains unchanged and aliases are not displayed in library or detail views.

## Status

This is a personal desktop project under active development. Interfaces and local data structures may change between releases.

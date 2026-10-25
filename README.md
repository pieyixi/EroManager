# ero-manager

A portable Windows desktop application for organizing a private local media and image collection. Its display name is **裏界箱庭**.

Browsing, playback and reading work offline. Optional source downloads require a network connection. Profiles and catalog data stay beside the executable; no hosted account service is required.

## Features

- Separate media and book catalogs with search, tags, filters, sorting and pagination.
- A discovery home with independent random draws, no-replacement cycles and per-profile draw history across restarts.
- Session-only collected cards with drag collection, expanded browsing and temporary removal.
- Shared cover transitions into details and back to the originating view.
- Embedded libmpv playback and an image reader with single/dual pages, reading direction, zoom and progressive image loading.
- Work-level random playback: finish episodes in order, then start another work from its first episode, using a separate per-profile no-repeat cycle.
- Metadata authoring, incomplete-entry review, local scans and guarded database-only or local-folder removal.
- Independent Eh and Hitomi download queues, per-source image concurrency from 1 to 5, bounded retries and failed-page recovery.
- A separate catalog with number/person views, original-language metadata, static image previews, local original/cut playback and manually saved magnet links. The acquisition page uses three tabs and five uniformly sized cards per row.
- Local profiles with circular avatars, inline nickname editing, preferences, favorites and playback/reading records.
- Optional four-digit PIN locks, configurable idle/background boundaries and a separate keyboard-driven administrator terminal.
- Light, dark and system appearance, catalog statistics, database snapshots and data-package exports.

## Current Version

The source and Windows application versions are **6.0.0**. Local builds, installed updates and published GitHub tags are separate states; a version label alone does not identify every subsequent local fix.

The current worktree includes:

- Startup queries and shared-lock waits dispatched away from the native window message thread, keeping dragging, maximizing and resizing available while content is prepared.
- One SQLite database for both catalogs, profiles and preferences, with guarded migration from an older separate book database.
- Windows named mutexes for per-installation instance control, without persistent lock files. The GUI and administrator terminal can run together.
- Coordinated statistics loading placeholders and SQL-based book-size totals after the initial capacity backfill.
- A collapsed card hand that expands on the first wheel event and accepts card switching only after expansion finishes.

## Navigation And Local Profiles

On the discovery home, single-click a main cover to open details and double-click it to draw again. Dragging a cover into the temporary hand collects it and refills that lane. The first wheel event over a collapsed hand only expands it; later wheel events browse the expanded cards. Temporary cards are not favorites and are not persisted.

Catalog details return to their catalog. Details opened from a completed download return to the download page with its scroll position restored; leaving the download page itself returns home.

Profiles use a unique four-digit ID; nicknames may repeat. Preferences, favorites, work records, draw-cycle history and random-playback history belong to each profile, while the catalog and library bindings are shared. The optional PIN provides an application privacy lock, not database-file encryption.

Run `ero-manager-admin.exe` beside the main executable to manage local accounts. Administrator ID `0000` is reserved for this tool; the first use asks you to set its PIN, with no default password. The terminal supports arrow keys, Tab, Enter and Escape, and uses the Windows default executable icon. It can manage accounts while the GUI is running through a local named pipe; it also works when the GUI is closed.

## Technology And Structure

Tauri 2, Rust, SQLite, Vue 3, TypeScript, Pinia, Vite and libmpv.

```text
frontend-vue/
  src/pages/          Route-level Vue pages
  src/components/     Rendering components grouped by domain
  src/features/       UI controllers and interaction state machines
  src/stores/         Shared state and business workflows
  src/api/            Typed commands, DTOs and development browser mock
  src/runtime/        Application startup and event wiring
  scripts/            Contract, architecture and regression checks
src-tauri/
  src/accounts/       Profiles, sessions, PINs and administrator terminal
  src/library/        Media index, scans, backup and database migration
  src/eh/             Book catalog, reader data and source download protocols
  src/av/             Metadata providers, catalog index and bounded local assets
  src/player/         Native playback, window layout and thumbnails
  src/paths.rs        Portable data and external backup paths
  src/runtime.rs      Native application setup and command registration
  lib/                Native playback runtime DLLs
```

Vue components own markup, Pinia owns shared state, and API adapters own typed native calls. Geometry and animations stay in UI controllers. Rust owns persistence, authorization, filesystem boundaries and native operations. See [frontend architecture](frontend-vue/ARCHITECTURE.md) for the dependency rules and [frontend development](frontend-vue/README.md) for browser workflow details.

## Development

Use Windows with Node.js/npm, the Rust MSVC toolchain, the Microsoft C++ build tools and the WebView2 runtime. Provide the playback DLLs expected under `src-tauri/lib/`. Python is used by selected verification and packaging helpers; it is not an application runtime dependency.

Install the frontend dependencies and run the browser preview from the repository root:

```powershell
npm --prefix frontend-vue ci
npm --prefix frontend-vue run dev
```

The default development URL is `http://127.0.0.1:1420/`, matching the Tauri configuration. An alternate browser-only port can be selected explicitly:

```powershell
npm --prefix frontend-vue run dev -- --host 127.0.0.1 --port 1422 --strictPort
```

The typed browser mock is enabled only in development without a Tauri connection. It is suitable for layout, theme and interaction checks. Production builds require native commands and do not load the mock catalog. `vite preview` serves a production bundle and is not the mock development environment.

Check the backend and build the frontend:

```powershell
cargo check --locked --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/path-verification
npm --prefix frontend-vue run build
```

The frontend build runs unit tests, dependency ownership/cycle checks, command/response/template contracts, strict Vue TypeScript validation and Vite bundling. Browser regressions live under `frontend-vue/scripts/`; filesystem, window, tray and libmpv behavior additionally need isolated native verification. Tests that require external sites or a designated media directory are opt-in.

## Windows Build And Portable Updates

From the repository root:

```powershell
npm --prefix frontend-vue run build
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/path-verification
python frontend-vue/scripts/remove-admin-icon.py src-tauri/target/path-verification/release/ero-manager-admin.exe
```

Use the same target directory for the build and packaging helper. This separate target avoids stale absolute paths from older checkout caches. The icon helper must run after the full Cargo build because the build can link GUI icon resources into the administrator executable again; it preserves version and manifest resources.

The portable runtime contains exactly these five program files:

```text
ero-manager.exe
ero-manager-admin.exe
lib/
  ero_manager_lib.dll
  libmpv-2.dll
  libmpv-wrapper.dll
```

Take the EXEs and `ero_manager_lib.dll` from the selected release target and the two playback DLLs from `src-tauri/lib/`. Build output is not an installed update. Close running instances gracefully, back up the previous program files outside the installation directory, replace only those five files, and start the intended installed executable to confirm its path, version and UI. Never bundle or replace an existing `db/`, `temp/` or media directory during a program update.

## Storage, Backup And Compatibility

All catalog indexes, profiles, avatars and preferences share `<application>/db/database.db`. SQLite can keep `database.db-wal` and `database.db-shm` beside it; these are part of the active database family. A single database file may have multiple connections.

Choose the additional catalog directory under Settings > Data before acquiring metadata. Each entry stores its JSON and supporting images in an owned folder; manually added links remain at the end of the JSON. Rebinding an existing directory rebuilds its index from marked folders. Acquisition uses a public third-party metadata interface with an official-page fallback; external availability and verification requirements can change. It does not download videos or trailers.

Default runtime backups, migration snapshots and data exports go to the sibling `backup/ero-manager backup/` directory. Explicitly selected export destinations remain user-controlled. Use SQLite-aware snapshots rather than copying a live database file alone.

The data-package exporter includes the unified database snapshot and non-video supporting files from media-catalog folders. It is not a full copy of video files or every book image directory; back up the underlying media separately.

An older separate book database is snapshotted, transactionally imported, checked and archived once. Conflicting or unknown data stops the migration instead of being overwritten; a migration marker prevents repeated imports. Current database restore accepts complete unified snapshots, makes a pre-restore snapshot and invalidates the active profile session. Old split-database backups are not complete replacements, and an older executable expecting separate databases cannot safely be restored by replacing program files alone.

The application retains its `com.hanime.manager` storage identity, `.hanime-library.json` marker, source metadata fields and legacy backup-format identifiers. Product renaming does not move or reset user data. Optional native test overrides use `ERO_MPV_LIBRARY` and `ERO_TEST_VIDEO`; their older `HANIME_*` aliases remain supported.

## Data Policy And Status

Personal databases, media, credentials, local handoff notes, recovery material, generated backups and release archives are excluded from source control. Download credentials are not serialized into download history. Keep personal data backups separate from source and program packages.

Metadata may include an optional top-level `search_aliases` string array for local search. Original titles are preserved, and aliases are not displayed in catalog or detail views.

This is a personal Windows desktop project under active development. Build and regression results describe their tested scope; browser mock checks do not establish live source availability or native playback behavior.

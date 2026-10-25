# Frontend Architecture

Product identity: **裏界箱庭** (display name), **ero-manager** (project and executable), **ero_manager_lib** (Rust library artifact). Preserve the `com.hanime.manager` storage identity, `.hanime-library.json` marker and backup-format identifiers. Runtime storage is one `<exe-directory>/db/database.db`; root/AppData database discovery has been removed and must not be restored. Legacy split-book storage is read only by the guarded one-time consolidation migration. The `hanime_url` field describes source metadata and is not a product name.

The active frontend is Vue 3 + TypeScript. Directory ownership follows existing responsibilities; this structure does not change routes, command names, DTOs, databases, portable paths, or product behavior.

## Responsibility Map

```text
src/
|-- App.vue                    Route composition and application lifetime
|-- pages/                     Ten route-level page components
|   |-- HomePage.vue            Independent media/book draws and temporary hand
|   |-- MediaLibraryPage.vue    Media browsing, sorting and pagination
|   |-- EhLibraryPage.vue       Book browsing (internal eh identifiers retained)
|   |-- EhDownloadPage.vue      Shared second-level download workspace
|   |-- EhReaderPage.vue        Reading UI and reader-specific window behavior
|   |-- DetailPage.vue          Existing media/book details
|   |-- PlayerPage.vue          Playback UI and explicit native stage refs
|   |-- SettingsPage.vue        Binding, scans and maintenance
|   |-- UnarchivedPage.vue      Incomplete entries
|   `-- ArchivePage.vue        Metadata authoring
|-- components/
|   |-- shell/                 AppShell, sidebar, browse toolbar, dropdowns, overlays
|   |-- shared/                Domain-independent back and window controls
|   |-- home/                  Draw cards, hand deck and muted animated sky
|   `-- downloads/             Source lane and failed-page popover
|-- features/
|   |-- shell/                 Search/filter and ordinary-window UI controllers
|   |-- home/                  Cohesive draw/hand gestures, layout and random pools
|   |-- reader/                Image presentation and navigation preparation
|   |-- player/                libmpv controller, layout, previews and adapter
|   `-- theme/                 Document-level theme transition
|-- stores/                    Shared state and business workflows
|-- api/
|   |-- contracts/             Backend DTOs, also used by browser fixtures
|   |-- commands/              Typed backend command families
|   |-- tauri.ts               Runtime-selecting adapter
|   `-- webMock.ts             Development-only browser implementation
|-- runtime/                   Application startup, keyboard and window events
`-- assets/
    |-- home/                  Approved card-back images
    |-- styles.css             Ordered global stylesheet entry
    `-- styles/                Eight shared slices, home, downloads and scoped reader
```

Pages compose business components. Business components stay with their actual domain rather than a generic shared directory. Shared components receive presentation state/events and do not import stores, APIs or domain features. Create a new domain directory only when several related files actually need one.

## Shell Boundary

`components/shell/AppShell.vue` assembles navigation, titlebar fragments, dropdowns and immersive chrome. `AppSidebar.vue` owns sidebar rendering and its navigation actions; `ShellBrowseToolbar.vue` owns filters, sort controls and search markup without introducing a wrapper element.

`features/shell/useShellBrowseControls.ts` owns the existing search/filter interaction, dropdown positioning, outside-click handling and route cleanup as one controller. It lives for the shell's lifetime even while immersive routes hide the toolbar. Search input/container refs are passed explicitly from the toolbar; measurement and document listeners never move into Pinia.

`features/shell/useShellWindowControls.ts` owns ordinary titlebar minimize, maximize, restore, close and resize subscription. Reader fullscreen and the native player controller remain separate. `components/shared/WindowControls.vue` only renders buttons and emits actions.

## State and Native Boundaries

- `navigation`: routes, return origins, confirmation and context menus.
- `library` / `ehLibrary`: independent browsing filters, sorting, pagination and details.
- Book favorites belong to `ehLibrary` and `eh/favorites.rs`, through typed `ehApi` commands. Detail identity buttons reuse character-favorite styling, while the book toolbar star filters signed gallery IDs. Current per-account favorites live in `AccountValues` (`favorite-book`); `EhFavoriteGalleries` remains for migration compatibility. Same-number sources stay distinct, and a gallery deletion transaction clears every account's matching favorite. Category/language metadata and home random pools remain independent.
- `home` / `homeHand`: independent no-replacement draws and process-local hand entries.
- `archive` / `libraryConsole`: authoring, binding, scans, imports and maintenance.
- `ehSettings`: binding, credentials, scan state and dashboard only.
- `ehDownload`: source inputs, independent Eh/Hitomi FIFO workers, process-local credentials, retries and credential-free history. Both sources may download one work simultaneously; each source snapshots its persistent image concurrency (1–5, default 3) when a work/retry starts. Aggregate activity stays true until both are idle. Per-source progress uses signed identities, and overlapping completion events coalesce serialized shared-library refreshes. Card stack order is independent of execution order.
- `ehReader`: reading state; presentation and local UI geometry stay outside the store.
- `player`: playback state coordinated by the existing player feature modules.
- `accounts` / `profile`: local account and avatar state; account controllers coordinate switching, locking and scoped personal writes. Rust owns PIN validation, authorization and persistence. Profile preferences, favorites, progress and draw history use the immutable account key in the unified database; UI geometry stays outside these stores.

Keep the cohesive home gestures, draw stages, carousel, hold/removal and reader presentation state machines intact. File length alone is not a reason to split them. This cleanup relocates their rendering components without changing those state machines.

The libmpv child window is not a Vue DOM node. Player layout measures only its explicitly registered stage/controls refs. Reader fullscreen must not reuse player fullscreen geometry.

## Dependency Rules

- Only `App.vue` imports route pages.
- Features and stores do not import rendering components.
- Stores may use pure domain helpers, but not UI composables or shell window/geometry controllers.
- API modules depend only on their API contracts/adapters, never Pinia or rendering.
- Shared components remain domain-independent.
- Imports, re-exports and literal lazy imports are checked. Runtime import cycles are rejected; type-only references do not create runtime cycles.
- No application-wide DOM queries, generated HTML or business handlers registered on `window`.

In browser development the same typed command contract selects `webMock.ts` only without Tauri and only in development mode. Components have no mock-specific behavior. Production never includes browser mock data as runtime library data.

## Style Ownership

`assets/styles.css` preserves the existing global cascade. The first eight shared slices retain their order; `downloads.css` owns download styling and `home.css` owns the complete home/draw/hand styling, including responsive rules. `reader.css` remains imported with `scoped` by `EhReaderPage.vue`. Directory cleanup must not rename selectors, add wrappers, change layout values or reorder rules.

The greeting remains muted, approved card backs and reveal parameters remain unchanged, and both libraries retain their existing navigation/filter state.

## Verification

`npm run build` runs unit tests, architecture checks, command/response parity, recursive Vue-template ID parity, strict Vue TypeScript and Vite. `npm run check:architecture` enforces import direction, component/page ownership, runtime-cycle detection, DOM rules and justified file-size exceptions.

Tests are colocated as `*.test.ts`; architecture-check tests live beside the scripts.

For structural work, capture the original source first, then compare the refactor:

```powershell
node scripts/verify-frontend-structure.cjs --before
node scripts/verify-frontend-structure.cjs --after
```

`HAND_QA_URL` selects the preview server. Reports and screenshots go to a task-specific directory under the system temporary folder. The harness compares flattened CSS and visible DOM/text/geometry at 1920x1080, 1366x768 and 1280x720, light/dark, across eleven page states; deterministic home fixtures avoid false differences from random draws. It also checks search, dropdown dismissal and return navigation. An original-source server must generate the baseline, not the already-refactored working tree.

Browser checks do not prove native window or libmpv behavior. Verify affected native interactions using an isolated portable runtime and isolated data; never use production data for architecture testing. Publishing and GitHub pushes require a separate explicit user request.

`scripts/verify-shell-native.ps1` accepts an `-ExecutablePath` and `-ReportDirectory`. It only launches a system-temp `ark-structure-native-*` portable copy with a precreated empty database, isolates the WebView profile, exercises navigation and window controls, captures actual desktop pixels, and closes its own test process. Do not pass the production executable.

Shared cover navigation lives in `features/shell/detailTransition.ts` and `components/shell/DetailCoverFlight.vue`. Home main/hand cards, media/book grids and completed download cards register local frame/image refs with one compositor. It owns only two temporary transform layers and cancels on unrelated navigation/resize. `useDetailCoverTargets` releases dynamic refs on removal; `usePageScrollPosition` restores each download lane before reverse geometry capture. Pinia owns the typed detail return page, including downloads through reader round-trips, without storing DOM geometry. The download workspace itself continues to return home.

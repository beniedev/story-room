English | [简体中文](AGENT_GUIDE.zh-CN.md)

# AI Agent Guide

This guide helps AI agents install, start, and explain Story Room for users. The first part follows the path from a repository link to writing; later sections retain the entry points and contracts needed for troubleshooting and code maintenance.

This is public project documentation. It does not replace the repository root [`AGENTS.md`](../AGENTS.md). The security, data, collaboration, and release rules in `AGENTS.md` are hard rules; this guide adds feature facts, a code map, and verification entry points. When code or tests change, re-check this page against the current code, tests, and applicable rules. Do not treat an old guide as an implementation promise.

## Help a user install, start, and use Story Room

When a user supplies only this repository link and wants to use the app, follow the local installation path: inspect the system and existing environment, get the source, install dependencies, start and open the app, then guide model setup and writing. Do not ask the user to choose an edition or try a demo first. Ask only when missing information affects existing data or cannot be determined locally; follow explicit review or development requests as given.

### 1. Check the existing environment

Check the operating system, shell, target directory, `node --version`, and `npm --version`. Supported Node versions are **22.x from 22.18.0, or 24.x**, matching `^22.18.0 || ^24.0.0` in `package.json`. Other major versions are outside the declared range.

For an existing installation, identify its startup method, working-tree changes, and library directory before reusing it. Do not read the contents of key configuration files or overwrite `.data/`, configuration, or uncommitted files. If a prerequisite is missing, explain the component and target version and act within the user's authorization; do not silently change the system's default runtime.

### 2. Get the source and start the local service

For a new checkout, these commands work in PowerShell and common POSIX shells; they contain no shell-specific environment assignments:

```bash
git clone https://github.com/beniedev/story-room.git
cd story-room
npm ci
```

Use the existing directory if source is already available. A ZIP download does not require Git; extract it and run `npm ci`. If repository access fails, report the access status rather than asking for GitHub credentials. The `private: true` package flag prevents npm publication; it does not describe GitHub visibility.

Run `npm run dev` in the project directory to start the local API and page together. Open **http://127.0.0.1:4310** by default. Complete startup, verification, and opening the page rather than only returning commands to the user.

Keep the terminal running; `Ctrl+C` stops it. Start again with `npm run dev` from the same directory. Installation does not require a background service. If the agent uses a background process to keep the app running, record the process it started and how to stop it; do not stop unrelated processes.

Use loopback by default. If the user wants access from other devices on a trusted network, explain `npm run dev -- --host 0.0.0.0`: other devices open the host computer's address, not `0.0.0.0` or their own `localhost`. Devices that can reach the service can use it. Ordinary installation does not include public deployment, background-service installation, or adding access steps to the product.

### 3. Verify the result

Check the process and startup errors, then open the actual page. A fresh local-host installation can be checked with same-origin `GET /api/health`, which returns JSON `{"ok":true}`. The default URL is `http://127.0.0.1:4310/api/health`.

Also check that JavaScript/CSS load, the shelf renders, and **设置 → 保存位置** (Settings → Storage location) matches the intended runtime. Report an HTTP 200, a running process, passing unit tests, and a successful user workflow as distinct results.

Do not use private manuscripts for installation tests. Installation verification can use synthetic content in a clearly named test book. Before creating anything in an existing library, explain what will be added and let the user choose the appropriate book.

### 4. Connect the user's AI service

In local-host mode, guide the user to **设置 → 模型连接** (Settings → Model connections) to enter a trusted service's URL, model ID, and key. Have the user enter the key in the interface, not the conversation; do not read or print key files. Before real generation, explain that selected writing material goes to that service, and proceed only when the user has authorized that call.

Choose **保存连接方案** (Save connection profile) after entering the fields. The success callback selects the saved profile automatically; confirm the name and model beneath **Model connections** and at the top of the manuscript page. Select an existing profile through **连接方案** (Connection profile), handling any unsaved-change prompt first. Testing neither saves a profile nor replaces verification of real generation.

**测试** (Test) checks `/models` connectivity and model matching when a list is returned. It does not prove that `/chat/completions` accepts the generation parameters. The initial built-in test connection is not a real model service; its output does not prove real AI is available. If service details are missing, finish installation and clearly identify the fields the user must enter locally. Do not substitute test mode for that delivery. Collect only sanitized error information, without credentials, manuscript text, raw requests, or configuration.

### 5. Guide the first writing session and backup

1. Choose **新建书目** (New Book) and confirm. A new book includes a chapter and section. With a real Provider selected, guide the user to enter text in a section and choose **发送并续写** (Send and continue). The user decides whether to send and what text to use.
2. In **本书设定** (Book settings), explain material loading: writing style and plot outline use **保存并加载** (Save and load); character and world entries have separate scope controls where chapters and sections are selected and confirmed.
3. **选择前文** (Select previous text) manages summaries of earlier sections; it is not the character or world settings screen. Confirm summaries and selections with **保存并加载梗概** (Save and load summaries).
4. On the shelf, choose **导出当前书目** (Export current Book), select JSON, then use **导入 JSON 备份** (Import JSON backup) to restore a copy. Check that it opens and the original remains. A completed download alone does not verify recovery.
5. Distinguish a saved book, a session recovery draft, and unsubmitted editor text. Editor contents may not be in JSON. Preserve them separately during a conflict before exporting the book and deciding whether to reload.

The [User guide](USER_GUIDE.md) supplies detailed steps and an [Interface labels table](USER_GUIDE.md#interface-labels). Keep the actual Chinese labels when explaining actions in English.

### 6. Troubleshoot common problems

| Symptom | Check and response |
| --- | --- |
| Port occupied | Identify whether an existing Story Room uses it. Reuse that instance or stop a process this task started; do not terminate unknown processes. `STORY_API_PORT` controls the API port; the development frontend port is in `vite.config.ts`. Do not assume one `PORT` setting changes both. |
| Page unavailable or blank | Check the command, address, process errors, and static responses. Restart the matching preview after rebuilding and check the actual page; a successful HTML response does not prove JS/CSS are correct. |
| Books missing in another browser or real generation unavailable | Check the address, actual storage location, and selected Provider; the symptom alone does not establish the cause. Locate and protect the original library instead of replacing it with an empty one or clearing browser data. |
| Save conflict | Preserve unsubmitted text, export the current Book, then let the user choose whether to reload and manually adopt content. Do not overwrite a newer version or clear storage. |
| Provider test passes but generation fails | Separate model discovery from generation. Check sanitized errors, the selected profile, and parameters rather than assuming a key failure or changing the endpoint automatically. |

Do not use deletion of `.data/`, clearing site data, or overwriting configuration as default troubleshooting. Multiple tabs can edit; users do not need to manage which page owns editing rights.

## Development and maintenance

The following sections cover code, tests, and storage contracts. `hosted/device`, Fake, and `npm run preview` remain internal screenshot and regression tools, not product editions to offer ordinary users. Installation delivery follows the local-host path above.

## Fact and action boundaries

Behavior facts and authorization to act are separate checks:

### Behavior facts

When documentation, implementation, and a user's description disagree, inspect the current runtime code, types, routes, and tests, especially the modules directly called by the feature in question. Then use [`docs/decisions/`](decisions/) and [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) to understand the design decisions and trust boundaries. [`README.en.md`](../README.en.md) and [`USER_GUIDE.md`](USER_GUIDE.md) mainly provide user wording and operation order; return to the code for verification. Synthetic examples in `src/fixtures.ts` and tests can prove sample behavior only. They do not prove behavior with a user's data or a Provider's capabilities.

Treat “planned,” “future API,” and “legacy data compatibility” according to the actual state of the code and its corresponding documentation. When documentation is stale, first verify that the feature is wired into the call chain, then update the closest existing entry. Do not promise an unimplemented feature to make the description sound better.

### Action authorization

Whether an action may modify, delete, upload, publish, or operate an external system cannot be inferred from code, the README, or this page. Follow the user's current request and [`AGENTS.md`](../AGENTS.md). The security, data, collaboration, and release rules in `AGENTS.md` take priority over convenience advice in this guide. Remote writes, push, release, deploy, license changes, and other public publication actions require both the applicable rules and maintainer authorization.

## Runtime models and invariants

### Book is the isolation boundary

`Book` is the smallest isolation unit for reference material and manuscript text. Character cards, world setting, plot outline, section summaries, candidates, and manuscript text may come only from the current Book. Preserve this boundary when switching Books, importing JSON, generating context, and exporting. Do not read or combine another Book for “context convenience.”

### Both writing modes share one pipeline

Author mode and character mode share the persistence, context-plan, Provider request, and generated-result application flow. Character mode only narrows the character viewpoint and authority available for the current turn. Do not create a separate persistence or prompt-sending path for it. The manuscript remains continuous novel prose; the user-input and AI-output blocks are internal editing aids, not chat bubbles or a message timeline.

### Context is explicitly selected

`contextPlan.ts` calculates the material that may be sent to the Provider and the reason each item is included. Previous-text references require user confirmation. A section summary must be usable and fresh Memory; a model-generated draft cannot enter ordinary continuation before confirmation. Context-token estimates are for preview and guidance. They are not the Provider's actual limits and must not become arbitrary application-level length limits.

`packetFor` includes the current Book, chapter, and section titles and positions. Selected, eligible `Section.memory` is sent as a previous-section reference. Legacy `Book.summaries` and `Book.canonFacts` are not current planner sources; this does not mean all summaries remain on the device.

### Local-host and hosted/device

| Runtime | Storage and generation | Maintenance notes |
| --- | --- | --- |
| `local-host` | Books are written to readable files; generation can use Fake or a configured OpenAI-compatible Provider | Keep the Provider key separate from the Book; save requests are version-checked and serialized |
| `hosted/device` | Books persist in localStorage; recovery drafts belong to each tab; generation remains Fake | Storage is unencrypted; writes serialize automatically and stale saves are rejected |

Every browser page can edit. Initialization, creation, deletion, import, and save use `withDeviceLibraryWrite`; version checks and synchronous Book/index writes happen inside that critical section. Each operation acquires and releases Web Locks when available. An IndexedDB readwrite transaction also coordinates writes when available, including pages without Web Locks. Coordination failures must surface; never replay a failed write outside the gate. IndexedDB stores no manuscript data.

Recovery drafts use per-tab `sessionStorage`, surviving reloads but ending with the tab session; Books remain in `localStorage`. Copy a legacy shared draft into the current tab before removing the old key, inside write coordination. Other tabs must not overwrite or clear this page's drafts. Successful older revisions may advance persistence and draft baselines, but cannot replace newer edits.

Coordination covers one browser storage area, not different devices or independent local-host processes.

## Code map

| Entry point | Responsibility | Check first when changing it |
| --- | --- | --- |
| [`src/App.tsx`](../src/App.tsx) | Runtime startup, Book selection, write coordination, autosave, conflicts, generation, and component callbacks | Check whether the same action already has a callback and save pipeline; do not add persistence in a component |
| [`src/types.ts`](../src/types.ts) | Data contracts for `Book`, `Chapter`, `Section`, blocks, candidates, `SectionContextReference`, and `SectionMemory` | Check whether a new field needs normalization, import validation, export support, and support in both runtimes |
| [`src/components/Bookshelf.tsx`](../src/components/Bookshelf.tsx) | Bookshelf, chapter/section directory, character/world lists (shared [`src/components/SourceList.tsx`](../src/components/SourceList.tsx)), book settings, material-loading scope, and name dialogs | Check the current Chinese labels, the `canEdit` read-only gate, confirmation dialogs, `Bookshelf.onBookChange` save callbacks, and per-list drag sorting in source selection mode |
| [`src/components/Writer.tsx`](../src/components/Writer.tsx) | Continuous manuscript view, author/character modes, block editing, candidate actions, generation input, and status messages | Check the target block for each generation action, read-only disabling, and candidate semantics |
| [`src/components/shared/InlineTitle.tsx`](../src/components/shared/InlineTitle.tsx) | In-place chapter and section title editing through double-click, double-tap, and keyboard input | Directory titles resolve pointer single/double activation within 300 ms; other row areas act immediately. Enter/Space invokes the directory primary action; F2 renames. Cancel pending actions on another target, scrolling, cancellation, disable or unmount. Preserve native input and save failures |
| [`src/components/ContextToolsDrawer.tsx`](../src/components/ContextToolsDrawer.tsx) and [`src/contextToolDrafts.ts`](../src/contextToolDrafts.ts) | Previous-text selection, session drafts, summary generation, and confirmation | Closing keeps unconfirmed drafts isolated by Book and section; only confirmation writes them. Existing inactive references can be explicitly retained or deselected |
| [`src/directoryOperations.ts`](../src/directoryOperations.ts) | Directory drag sorting with stable IDs, inverse positions, and reference eligibility changes | Keep sorting in directory selection mode; do not delete and recreate entries or undo with whole-Book snapshots. Adopt a new order only after saving succeeds |
| [`src/components/ContextCompositionDrawer.tsx`](../src/components/ContextCompositionDrawer.tsx) | “Current context overview,” including material, reasons, and estimates | Show summaries only; do not expose raw Provider messages or hidden reasoning |
| [`src/components/ProviderSettings.tsx`](../src/components/ProviderSettings.tsx) and the settings area in `App.tsx` | Provider form, model limits, testing, key guidance, streaming toggle, and `ProviderProfile` connections from `src/providerProfiles.ts` | Check host/device key lifetimes and the meaning of the `/models` test |
| [`src/contextPlan.ts`](../src/contextPlan.ts), `src/contextReferences.ts`, `src/sourceSelection.ts` | Material selection, source signatures, summary/full-text references, budget estimates, the prompt packet, and per-item source ordering via `moveSourceItem` | Use the current Book only; do not treat the preview as a raw prompt echo |
| [`src/generationRequests.ts`](../src/generationRequests.ts) | Target ranges for continuation, answers, and block regeneration | Regeneration excludes the target and later content; `respond-to-input` does not repeat user input |
| [`src/answerCandidates.ts`](../src/answerCandidates.ts) | Candidate reading, adoption, addition, deletion, and retention across saves | `content` is the projection of the currently adopted candidate; arrow navigation is not generation |
| [`src/sectionMemory.ts`](../src/sectionMemory.ts) | Section Memory structure, content fingerprint, freshness, confirmation, previous snapshot, and rollback | An unconfirmed `model-draft` cannot support ordinary continuation; manuscript changes expire Memory |
| [`src/bookImport.ts`](../src/bookImport.ts) and [`src/bookExport.ts`](../src/bookExport.ts) | JSON validation/normalization, new-ID imports, and EPUB/Markdown/TXT/JSON export | Imports create a copy without overwriting the current Book; validate references and candidate relationships within one Book |
| [`src/api.ts`](../src/api.ts) | Host/device API shape, runtime split, Provider testing, and generation responses | Device generation remains Fake; do not write a temporary key to the story or `localStorage` |
| [`src/deviceLibrary.ts`](../src/deviceLibrary.ts) and [`src/deviceWriterLease.ts`](../src/deviceWriterLease.ts) | Persisted device Books, draft boundaries, and per-operation write coordination | All mutations must use the same write gate; plain reads and exports stay pure |
| `server/domain.ts`, `server/store.ts`, `server/providers.ts`, `server/providerStream.ts` | Local-host Book reads/writes, version conflicts, Provider calls, and the streaming protocol | Preserve full-Book saves, the serialized save queue, key/Book separation, and real error propagation |
| [`src/fixtures.ts`](../src/fixtures.ts) and `tests/` | Synthetic examples, legacy-data compatibility, feature contracts, and regression verification | Use neutral fake data only; do not mistake test doubles for production capability |

`src/styles.css` owns visual styling and responsive layout. Visual-only changes must preserve native form semantics, keyboard operation, and `canEdit` state. Do not use CSS to make a still-writable control look disabled.

## Common maintenance tasks

### Changing copy or one control

Use `rg` in `src/App.tsx` and the relevant component to find the existing Chinese label, then edit the location nearest to the actual render. Check that aria labels, titles, status messages, and confirmation descriptions do not contradict one another. The user guide records real labels; do not invent an operation path for convenience.

### Adding or changing Book data

Start with `src/types.ts`, then check:

1. Whether `normalizeBook` and related domain helpers can read older Books.
2. Whether `bookImport.ts` validates and restores the field.
3. Whether `bookExport.ts` preserves content needed for backup.
4. Whether `server/store.ts`, `deviceLibrary.ts`, and the App's shared save flow can all write it back.
5. Whether Book switching, conflicts, candidates, and previous-text references still preserve Book isolation.
6. Add a narrow test that proves the real behavior, then run the full verification required by the rules.

Do not call `localStorage.setItem` directly in a component or create a shortcut that saves only part of a Book. Ordinary Book changes, material confirmation, candidate adoption, and previous-text references must use the existing complete save pipeline. The application has no arbitrary limits on manuscript length, candidate count, or Memory item count; actual context and output limits come from the configured Provider.

### Changing context or generation

Read `contextPlan.ts`, `generationRequests.ts`, and the relevant tests first. Identify the request's unique target, source range, and candidate source signature. Also check the visible summary in `ContextCompositionDrawer`: it should broadly match the real inclusion reasons but must not show raw Provider messages or hidden reasoning.

When changing material loading, preserve these facts: the plot outline is future guidance; for `continue-section`, request `authorNote` takes precedence over `section.note`; other body-generation requests use the current `section.note`, sent verbatim as a final assistant message and omitted when empty; the app does not write that note into manuscript blocks or append it to generated results; Section Memory must be fresh and confirmed; and an unconfirmed previous-text selection must not be written to the Book. Both author and character modes must go through the same persistence/context/Provider/apply pipeline.

Generation responses can include `finishReason`. Apply `stop` normally; keep `length`, `content-filter`, `refusal`, and `unsupported` drafts copyable but unapplied to prose, candidates, or saved summaries. Missing or `unknown` reasons follow the ordinary apply path with a notice that the service did not report a clear reason. Use this structured field rather than guessing from draft wording, and preserve request-target and Book-session guards for late results.

### Changing a Provider or API key

The usual entry points are `src/providerProfiles.ts`, `src/api.ts`, `src/components/ProviderSettings.tsx`, and `server/providers.ts`. Separate local-host from device:

- Local-host can save Fake or OpenAI-compatible profiles. Handle the key in the separate Provider configuration under the existing rules; never put it in the Book, JSON, fixture, logs, or error text.
- Device generation remains Fake. A connection test may temporarily send the key to the entered `/models` URL; page scripts can read it while the request runs, but the application does not persist it.
- “Test succeeded” means only that `/models` was reachable and, when a list exists, that the model ID was found. It does not prove `/chat/completions` parameter compatibility.
- The context plan determines what the Provider actually receives. Interface changes must not bypass Book isolation or echo raw internal messages to the UI.

### Changing Section Memory or previous-text selection

Start with the draft, freshness, provenance, and previous-snapshot semantics in `sectionMemory.ts`, then inspect `ContextToolsDrawer.tsx` and the App's generation/confirmation callbacks. A generated `model-draft` remains a page editing draft until the user confirms “Save and load summary.” Only then does it become usable Section Memory and a context reference. After manuscript edits, recalculate freshness from the content fingerprint instead of carrying the old summary forward unconditionally.

An App-owned session Map isolates drawer drafts by Book and target section; it does not write them to persistent browser storage. Clicking outside or closing the drawer keeps pending edits without applying them. A red note below each affected previous-section name marks unsaved changes and clears after successful save confirmation. Late generation results must check both session identity and request generation. Deleted targets must not regain drafts. Pending changes across all sessions contribute to the leave-page warning.

Directory drag sorting changes story order only. The six-dot handles appear in directory selection mode and support mouse or touch dragging. `getDirectoryMoveImpact` compares ordering eligibility, does not generate summaries, and does not promise that stale summaries are usable. When confirming references, `contextReferences.ts` retains existing current/future references that the user still selects, but cannot create new future references through that path. Undo stores an inverse position and applies it to the latest Book; never replay a whole old Book over later prose edits.

Character-card and worldbuilding lists use selection mode for per-item six-dot drag sorting. Both lists share [`src/components/SourceList.tsx`](../src/components/SourceList.tsx); `src/sourceSelection.ts`'s `moveSourceItem` computes each move, and `Bookshelf.onBookChange` routes it through the existing Book save chain. Each handle supports mouse or touch dragging; focus it and press Arrow Up or Arrow Down to move one item at a time, and press Escape to cancel an in-progress drag. Dragging one item within its own list saves the new order automatically; grouped dragging and Undo are not supported.

### Changing device write coordination

Start with `deviceWriterLease.ts`, `deviceLibrary.ts`, the App save queue, and storage events. Every Book/index mutation must recheck its version inside the same short critical section. App callbacks must not write persisted Books again after the API returns. Drafts belong to the current tab; export has no write side effects. Do not restore page ownership, takeover controls, polling, or forced locks.

Cover real concurrent tabs, interleaved initialization/create/delete/import/save, same-Book conflicts, and per-tab reload recovery. Referenced directory moves must pass real disk save, JSON import, and undo. Future-position references can be stored; model context still strictly excludes current and future sections.

## Reproducing issues with synthetic data

Prefer the repository's neutral examples for reproduction and tests: `createExampleBooks()`, `createLegacyFixtureBook()`, the Book export/import helpers, and `tests/helpers/fakeDeviceLocks.ts`. When writing a fixture, use invented book names, characters, chapters, and content. Never copy a user's work, real names, accounts, device names, addresses, endpoints, or keys.

Choose the scenario that matches the current issue; there is no need to cover the entire flow every time. Small scenarios include:

- Generation, candidate, or manuscript issues: use Fake Provider with a Book containing one chapter and two or three sections. Cover the relevant author/character mode, empty manuscript, final user-input block, multiple AI candidates, or cancellation.
- Material or context issues: use only the current Book's character cards and world setting, then compare `contextReferences` and the visible context summary before and after confirmation.
- Import/export issues: use a complete JSON string in memory and confirm that import creates a new ID without overwriting the original Book.
- Device concurrency issues: use isolated test storage and real browser tabs to verify concurrent writes, stale revisions, and draft isolation.
- Provider issues: use fake responses or Fake Provider; never send a key to a real endpoint.

These cases can reproduce behavior and can safely enter public tests and `issue` reports. If an issue occurs only with a real Provider or a particular browser, record the abstract capability and error shape. Do not bring credentials, complete requests, raw private logs, or a user's manuscript into the repository.

## Verification entry points

The repository rules require these commands before claiming completion:

```bash
npm test
npm run typecheck
npm run build
npm run build:local
```

To narrow the scope quickly, start with relevant tests such as:

```bash
npx vitest run tests/book-import.test.ts tests/book-export.test.ts tests/context-reference.test.ts tests/section-memory.test.ts
npx vitest run tests/app-device-recovery.test.tsx tests/device-library.test.ts tests/device-writer-lease.test.ts
npx vitest run tests/writer-ui.test.tsx tests/context-ui.test.tsx tests/candidate-saving.test.tsx
```

For public-content or dependency changes, also run:

```bash
npm run privacy:scan
npm run license:check
git diff --check
```

State which behavior each check verifies. Static types and the build prove that the package builds. Tests prove contracts with synthetic data. The privacy scan reports known private patterns found in the current tree. None of these proves a real Provider call, cross-device sync, or a natural use cycle.

## External release and maintenance

Documentation, code, and tests may be maintained within the currently authorized repository task. Remote writes, push, release, deploy, license changes, and other public publication actions remain subject to maintainer authorization under [`AGENTS.md`](../AGENTS.md). Before preparing public content, re-check filenames, body text, fixtures, error text, build metadata, and reachable history, using generic project terms and synthetic data.

Do not write local absolute paths, private deployment names, real manuscripts, Provider keys, browser data, internal tickets, or raw runtime logs into the public repository. Provider endpoints and device storage are trust boundaries. Documentation must state the current implementation's risks and limits accurately; do not let the word “local” imply encryption, automatic backup, or multi-user collaboration.

If a user asks for a new feature, find the narrowest implementation entry in code and tests before deciding which documents need updating. If there is only a plan or design, label it “not implemented” or “planned.” Describe it as current only after the call chain, tests, and user interface are connected. When a feature is complete, update the operation steps in [`USER_GUIDE.md`](USER_GUIDE.md) and the module entry on this page together, so the project does not grow a third set of rules.

## Quick troubleshooting table

| Symptom | Check first | Correct user explanation |
| --- | --- | --- |
| A device save fails | Write coordinator, browser storage, and current Book revision | Keep local edits; report the actual failure and allow JSON export. Do not request editor ownership. |
| A change does not appear immediately | App autosave state, `updatedAt`, the save queue, and storage events | Check the status message first. On conflict, export JSON and explicitly reload; there is no automatic merge. |
| An AI answer seems to repeat the user input | The `respond-to-input` path in `generationRequests.ts` and “Generate answer” in Writer | The action under the final user block generates an answer; it does not copy that input. |
| A changed summary does not affect generation | The confirmation flow in `ContextToolsDrawer.tsx`, Section Memory freshness, and `contextReferences` | Confirm “Save and load summary.” Closing the previous-text drawer without confirmation has no effect. |
| Provider testing succeeds but generation fails | The `/models` test semantics, Provider implementation, and the actual `/chat/completions` response | The test proves model discovery or connectivity only, not full generation compatibility. |
| Import might overwrite the original Book | `bookImport.ts` and the App's import callback | JSON import creates a recovery copy; the original Book is not overwritten. |

For behavior not covered here, preserve the evidence and the smallest synthetic reproduction, then return to the source-of-truth order. Do not cover an unknown state with a speculative success message or documentation claim.

## Local runtime and API details

These details support installation troubleshooting and API maintenance. Ordinary users can write with the settings screen and existing startup scripts. Maintainers can verify the built local host with `npm run build:local` and `npm run server`, defaulting to `http://127.0.0.1:4311`; this does not require users to choose another edition.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `STORY_DATA_DIR` | `.data/` | Local library root |
| `STORY_PROVIDER_CONFIG` | `.data/private/providers.json` | Separate Provider configuration file, potentially containing plaintext keys |
| `STORY_API_PORT` | `4311` | Local API port; the development Vite proxy reads the same value |
| `STORY_HOST` | `127.0.0.1` | Bind address for `npm run server`; `npm run dev` sets it from `--host` |
| `STORY_STATIC_DIR` | `dist-local` | Static directory served by `npm run server` |

Paths resolve from the startup working directory. `STORY_DATA_DIR` and `STORY_PROVIDER_CONFIG` are independent: neither changes the other or migrates files. `scripts/dev.mjs` reads the project's `.env.local`; direct `npm run server` does not, so variables must come from its startup environment. PowerShell uses `$env:NAME = 'value'`; POSIX shells support `NAME=value command`. Check the startup method before supplying commands, and do not read or print key values.

Local Provider keys are plaintext. POSIX writes use `0600`; Windows permissions are not treated as an equivalent credential store. Changing a saved profile's `endpoint` or `kind` requires re-entering its key. User-configured HTTP/HTTPS Providers may use public, loopback, LAN, or private-network addresses; metadata and link-local targets and redirects remain rejected.

`POST /api/context-plan` returns a compact preview. `POST /api/generate` returns a draft, optional `finishReason`, and candidate source signature without echoing internal messages. A boolean `stream` option selects `application/x-ndjson`: lines contain `{"type":"delta","text":"…"}`, followed by `{"type":"result","result":{…}}` carrying the ordinary result, or `{"type":"error","error":"…"}`. The final `result` ends the generation response; `finishReason` determines whether its draft may be applied, and a disconnected stream is not a complete response. Non-streaming requests still return JSON. Section summaries wait for a complete structured result rather than the manuscript's streaming display.

Saves still transfer and validate the entire Book and compare the saved `updatedAt` revision. Repeated saves of an unchanged version reuse the result; the local host skips rewriting unchanged source and manuscript files. The app imposes no arbitrary manuscript, candidate, request, or response size caps; large books still need more memory and I/O. Context and output settings accept positive safe integers, with actual support determined by the Provider. Context estimates inform rather than block generation. The [incremental-save API](INCREMENTAL_SAVE.md) is not implemented.

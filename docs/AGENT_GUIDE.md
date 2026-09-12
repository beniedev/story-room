English | [简体中文](AGENT_GUIDE.zh-CN.md)

# AI Agent Guide

This guide is for AI agents that explain Story Room, fix issues, or maintain the repository. It gathers the current implementation entry points and the boundaries that are easy to miss, so an agent can explain the product accurately before starting in the right module.

This is public project documentation. It does not replace the repository root [`AGENTS.md`](../AGENTS.md). The security, data, collaboration, and release rules in `AGENTS.md` are hard rules; this guide adds feature facts, a code map, and verification entry points. When code or tests change, re-check this page against the current code, tests, and applicable rules. Do not treat an old guide as an implementation promise.

## Explaining features to users

Start with the following short explanation, then expand it to fit the user's question:

> Story Room is a local-first workspace for continuous novel writing. Each Book keeps the manuscript, chapters, character cards, world setting, plot outline, and writing guidance isolated. You can continue in author mode or choose a character and write from that character's first-person viewpoint. AI output is saved as candidate manuscript versions that you can compare and keep. In local-host mode, books are written to readable files and can use an OpenAI-compatible Provider you trust. In hosted/device browser mode, books stay in the current browser's `localStorage`, and generation uses the Fake Provider. The application has no cloud sync, so important work should be exported as a JSON backup.

When answering a concrete question, explain the current runtime first, then where data is stored and which control performs the action. The interface is currently in Chinese; use the [Interface labels table](USER_GUIDE.md#interface-labels) for the exact labels. Do not describe “Provider testing” as real generation support in device mode, and do not describe “context preview” as hidden reasoning. If a user needs to know whether a control exists, check the actual rendered label in the current component.

When explaining generation, cover at least these points:

1. “Send and continue” continues from the current section. “Generate answer” under the last user input does not repeat that input.
2. “Regenerate” adds a candidate. “Previous version” and “Next version” only switch and save the current candidate; they do not call the AI again.
3. With “Streaming output” enabled, unfinished temporary text is still a draft. Cancelling or failing does not write it to the Book.

When explaining materials and context, make clear that “Save and load” is an explicit confirmation action. Writing guidance, the plot outline, character cards, world setting, and previous-text summaries enter later generation only after confirmation. The context overview shows included material and the reasons for inclusion; it does not show raw Provider messages or hidden model reasoning.

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
| [`src/components/shared/InlineTitle.tsx`](../src/components/shared/InlineTitle.tsx) | In-place chapter and section title editing through double-click, double-tap, and keyboard input | A single pointer click on a title does not navigate; other row areas open or expand immediately. Preserve input-method handling, cancellation, save failures, and disabled states |
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

When changing material loading, preserve these facts: the plot outline is future guidance; a current-section note applies only to its relevant request; Section Memory must be fresh and confirmed; and an unconfirmed previous-text selection must not be written to the Book. Both author and character modes must go through the same persistence/context/Provider/apply pipeline.

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

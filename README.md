# Story Room

Story Room is a local-first novel-writing workspace: a local Node host writes a readable Book directory, while the hosted/device build stores Books only in the current browser. It does not provide cloud manuscript storage or synchronization.

The manuscript stays continuous prose rather than a chat transcript. Each Book stores its characters, world rules, canon, summaries, chapters, and sections; stored summaries and Canon facts are not hidden Provider prompt inputs. Author and first-person character modes share the same persistence and prompt pipeline, and the UI shows a compact context preview, budget, and any explicit degradation without exposing raw Provider messages or hidden model reasoning.

## Two runtimes

| Runtime | Book persistence | Provider behavior |
| --- | --- | --- |
| Local host | Readable files under `.data/` by default; set `STORY_DATA_DIR` to choose another directory | Fake Provider or OpenAI-compatible Provider; generated context plans are sent to the configured endpoint |
| Hosted/device | Unencrypted `localStorage` in the current browser and origin | Fake generation only; Provider tests send the current page's temporary key to the configured `/models` endpoint |

The hosted/device build does not upload or merge Books. A complete JSON backup contains the manuscript, blocks, answer candidates and their adopted versions, branches, Book settings, prompt-loading scope, and Section Memory data (including a previous snapshot when present). The shelf's JSON import action validates that structure and restores it as a new Book with a new ID; it never overwrites the original or an existing Book. EPUB, Markdown, and TXT exports contain the adopted manuscript, without unadopted candidates. Clearing site data removes the device-local library.

## Run locally

Requirements: Node.js 22.18+ and npm. The supported Node.js major lines are 22 and 24.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4310`.

The default bind address is `127.0.0.1`. To use the same host from another device on a trusted LAN or private network, choose the bind address explicitly, for example `npm run dev -- --host 0.0.0.0`. The app does not add an access-password, token, or Host allowlist; any device that can reach the chosen address can use it. State-changing browser requests that include an `Origin` header must remain same-origin.

Configured Providers may use HTTP or HTTPS on public, loopback, LAN, or private-network addresses without an extra opt-in flag. Metadata and link-local targets and redirects remain rejected to avoid sending credentials to unintended services.

## Provider trust boundary

The local host supports the deterministic Fake Provider and OpenAI-compatible endpoints. The context plan and prompt for a generation request are assembled internally and sent to the Provider endpoint configured by the user. `/api/context-plan` returns a compact preview; `/api/generate` returns the draft and source-signature metadata for answer comparison, without echoing the internal messages. The writing UI does not display raw Provider messages. The local-host API Key is stored as plaintext in `.data/private/providers.json` by default; set `STORY_PROVIDER_CONFIG` to choose another file. On POSIX, the file is written with mode `0600`. Windows file permissions are not treated as an equivalent credential store. Changing a saved profile's endpoint or kind requires entering its key again.

In hosted/device mode, generation remains Fake. A Provider test sends a temporary key to the configured `/models` endpoint; page scripts can read that input while the page is running, and the key is not persisted by the app. A successful test proves only that the endpoint responded and, when it returned a model list, that the configured model ID was present. It does not prove that `/chat/completions` accepts this app's generation parameters.

## What is implemented

- Continuous prose editing with author and first-person character modes
- Book-scoped character cards, world rules, canon, summaries, chapters, and sections
- Readable local-host persistence and device-local hosted persistence
- Recoverable local-host full-Book saves, stale-save rejection, and JSON backup restore-as-copy
- Fake and OpenAI-compatible local-host Provider paths
- Compact prompt preview with provenance, inclusion/exclusion reasons, and an approximate size budget
- EPUB, Markdown, TXT, and complete JSON exports
- Responsive controls for desktop and mobile-sized viewports

### Saving and recovery

Every update still saves and validates the whole Book. The client sends the `updatedAt` value from the version it loaded, and the local host compares that value inside its serialized save queue. If another page saved first, the stale request is rejected with HTTP 409 instead of overwriting the newer Book. The page keeps its local edits and answer candidates available, stops further stale autosaves, and offers JSON export or an explicit reload; it does not attempt an automatic merge.

Before publishing a local-host save, the store records a private transaction journal and snapshots the previous managed Book files plus the library index. A failed in-process save is rolled back immediately. Book deletion uses the same recovery area: the complete Book tree is first moved into its prepared transaction, the library update is published, and only then is the deletion committed and physically cleaned. After a restart, an uncommitted save or deletion is rolled back, while a committed transaction is retained or completed and its cleanup is retried safely. Reads, saves, imports, and deletes use the same process-local queue so a normal request cannot observe the store halfway through that recovery. This protects transaction consistency, not against disk loss or two independent host processes sharing one data directory, so important work still needs external backups.

The hosted/device runtime applies the same stale-revision rule to its browser-local Books and listens for same-origin storage changes from other pages. Browser events and `localStorage` are not a collaboration or durability system; conflict recovery remains export or reload.

### Generating and comparing answers

The selected model profile is remembered in the current browser and origin. If that profile has been removed, the app selects an available profile. Local-host connection settings and keys remain on the host.

After editing an already-sent user passage, use “再生成一版” on its answer to generate a new candidate from the latest adopted text before that answer. The old answer, its alternative candidates, and later passages are excluded from that request. If the manuscript ends with a user passage, “生成回答” beneath it generates an answer without duplicating the user passage or consuming the next draft in the bottom input.

The candidate arrows switch the current manuscript version immediately and save the choice in the background; they do not start generation. The existing edit, delete, and “再生成一版” actions apply to the displayed answer. Generating another candidate selects it automatically. Subsequent generation, ordinary exports, statistics, and Section Memory freshness use the current version. Switching an answer in the middle of a section preserves later passages, which may need a continuity review.

Candidates remain available across refreshes until the next new input receives an answer that is successfully saved. At that point, only the current version of the preceding answer is retained; its other candidates are removed. Failure or cancellation preserves those choices. Regenerating an answer or continuing without a new input does not clear candidates. Complete JSON backups include the candidates still present in the Book.

Candidate source signatures record changes in writing material without storing another full prompt snapshot. Existing Books remain readable without a bulk migration, and candidate counts have no application-defined cap.

Settings includes “流式输出”, off by default and remembered in the current browser. When enabled, manuscript generation displays incoming text progressively. A complete result uses the same manuscript and candidate-saving flow as a non-streamed answer. If generation is cancelled or fails, the partial text remains available to select and copy on the page; it is not saved into the Book. Starting another generation replaces that temporary preview, and reloading the page clears it. Section Memory generation still waits for its complete structured result. Hosted/device mode remains Fake.

For local API clients, `POST /api/generate` accepts an optional boolean `stream`. A streamed response uses `application/x-ndjson` with `delta` events containing `text`, followed by a `result` event containing the ordinary generation result, or an `error` event. Only the final `result` means generation completed; an interrupted connection is not a completed answer. Requests without streaming retain the JSON response format.

### Context planning

The writing page's Context drawer shows the active Provider limits, an approximate input budget, and an overview of included material and reasons for the current request. If a request is over budget or material is excluded or degraded, the preview says so explicitly. It does not display raw Provider messages or hidden model reasoning. The local-host Provider still receives the internally assembled messages for that generation; the API returns only the context preview or generated draft needed by the app.

Cancelling a generation aborts the local request and propagates the abort to the Provider fetch. Generation has no application-defined deadline; the author can cancel while waiting. A late result cannot write to the manuscript or Memory, and cancellation does not clear the author's current input or note. This cannot retract work already accepted by a configured endpoint or remove that endpoint's logs.

The Book-level plot outline (`plotOutline`, shown as “剧情大纲”) is included in normal continuation and block-regeneration prompts as future guidance. A Section `note`, shown as the current section guidance in the writing page, is included in non-summary prompts for that Section; notes from other Sections are not included. Legacy Section `plan` data remains readable and exportable but is not inserted into Provider prompts. Book summaries and Canon facts are likewise stored/exportable Book data, not hidden prompt sources. In “前文选择”, a checkbox loads or removes an earlier Section, while the rest of its row expands an inline synopsis editor. A Section Memory is a five-field structured summary that starts as a model draft or manual draft; generating a synopsis changes only the local draft until the user confirms save-and-load. The current Memory and its previous snapshot are persisted with the Book and included in complete JSON export.

Model-generated memory is never inserted into ordinary continuation until it is confirmed. Hosted/device generation remains Fake, and there is no automatic cloud storage or synchronization. Provider keys and endpoints remain a trust boundary: only enter a temporary device test key when you trust the current page and destination URL; local-host keys are stored as described above.

## Current limits

- API requests, Provider responses, and Section Memory have no application-defined size or item-count caps. Saves still transfer and validate the whole Book. The app reuses saves of the same unchanged revision, and the host skips rewriting identical source and manuscript files. Large Books still require more memory and I/O. A future Section/source revision API is outlined in [`docs/INCREMENTAL_SAVE.md`](docs/INCREMENTAL_SAVE.md); that API is not implemented.
- Context estimates are advisory and do not block generation. Model context and output settings accept positive safe integers; the configured Provider determines its actual supported limits.
- Browser `localStorage` is not encrypted and is readable by same-origin scripts. Clearing site data deletes device-local Books, and the device runtime does not provide filesystem-style transaction recovery.
- The local host and Provider endpoint are not a production deployment. Browser, operating-system, or configured endpoint compromise is outside this demo's guarantees.
- There is no cloud storage, account sync, multi-user collaboration, RAG, embeddings, or desktop wrapper.

This is a functional pre-release demo, not a production writing system. See [`SECURITY.md`](SECURITY.md), [`PRIVACY.md`](PRIVACY.md), and [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for boundaries and reporting guidance.

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run build:local
npm run privacy:scan
npm run license:check
```

## Typeface and notices

The optional LXGW WenKai Lite font is distributed under the SIL Open Font License 1.1; see [`public/fonts/OFL.txt`](public/fonts/OFL.txt). Package and asset attribution is recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

The project code is available under the [MIT License](LICENSE). Bundled third-party assets remain under their respective licenses.

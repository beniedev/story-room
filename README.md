# Story-native Writing Harness

Story-native Writing Harness is a local-first novel-writing harness: a local Node host writes a readable Book directory, while the hosted/device build stores Books only in the current browser. It does not provide cloud manuscript storage or synchronization.

The manuscript stays continuous prose rather than a chat transcript. Each Book stores its characters, world rules, canon, summaries, chapters, and sections; stored summaries and Canon facts are not hidden Provider prompt inputs. Author and first-person character modes share the same persistence and prompt pipeline, and the UI shows a compact context preview, budget, and any explicit degradation without exposing raw Provider messages or hidden model reasoning.

## Two runtimes

| Runtime | Book persistence | Provider behavior |
| --- | --- | --- |
| Local host | Readable files under `.data/` by default; set `STORY_DATA_DIR` to choose another directory | Fake Provider or OpenAI-compatible Provider; generated context plans are sent to the configured endpoint |
| Hosted/device | Unencrypted `localStorage` in the current browser and origin | Fake generation only; Provider tests send the current page's temporary key directly to the URL you enter |

The hosted/device build does not upload or merge Books. A complete JSON export contains the manuscript, blocks, branches, Book settings, prompt-loading scope, and Section Memory data (including a previous snapshot when present). It also offers EPUB, Markdown, and TXT exports. Clearing site data removes the device-local library.

## Run locally

Requirements: Node.js 22.18+ and npm. The supported Node.js major lines are 22 and 24.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4310`.

The local host binds only to loopback (`127.0.0.1`, `localhost`, or `::1`) and is intended for the current machine. Non-loopback addresses are not a supported deployment mode. `STORY_ALLOW_PRIVATE_PROVIDERS=1` only opts into HTTPS private-network Provider targets; metadata and link-local targets and redirects remain rejected.

## Provider trust boundary

The local host supports the deterministic Fake Provider and OpenAI-compatible endpoints. The context plan and prompt for a generation request are assembled internally and sent to the Provider endpoint configured by the user. `/api/context-plan` returns a compact preview; `/api/generate` returns the draft only. The writing UI does not display raw Provider messages. The local-host API Key is stored as plaintext in `.data/private/providers.json` by default; set `STORY_PROVIDER_CONFIG` to choose another file. On POSIX, the file is written with mode `0600`. Windows file permissions are not treated as an equivalent credential store. Changing a saved profile's endpoint or kind requires entering its key again.

In hosted/device mode, generation remains Fake. A Provider test sends a temporary key directly to the URL in the current page; page scripts can read that input while the page is running, and the key is not persisted by the app.

## What is implemented

- Continuous prose editing with author and first-person character modes
- Book-scoped character cards, world rules, canon, summaries, chapters, and sections
- Readable local-host persistence and device-local hosted persistence
- Fake and OpenAI-compatible local-host Provider paths
- Compact prompt preview with provenance, inclusion/exclusion reasons, and an approximate size budget
- EPUB, Markdown, TXT, and complete JSON exports
- Responsive controls for desktop and mobile-sized viewports

### Context planning

The writing page's Context drawer shows the active Provider limits, an approximate input budget, and an overview of included material and reasons for the current request. If a request is over budget or material is excluded or degraded, the preview says so explicitly. It does not display raw Provider messages or hidden model reasoning. The local-host Provider still receives the internally assembled messages for that generation; the API returns only the context preview or generated draft needed by the app.

Cancelling a generation aborts the local request and propagates the abort to the Provider fetch. User cancellation and the 180-second Provider timeout are reported separately; a late result cannot write to the manuscript or Memory, and cancellation does not clear the author's current input or note. This cannot retract work already accepted by a configured endpoint or remove that endpoint's logs.

The Book-level plot outline (`plotOutline`, shown as “剧情大纲”) is included in normal continuation and block-regeneration prompts as future guidance. Legacy Section `plan` and `note` fields may remain in an imported Book for read/export compatibility, but they are not inserted into Provider prompts. Book summaries and Canon facts are likewise stored/exportable Book data, not hidden prompt sources. In “前文选择”, a checkbox loads or removes an earlier Section, while the rest of its row expands an inline synopsis editor. A Section Memory is a five-field structured summary that starts as a model draft or manual draft; generating a synopsis changes only the local draft until the user confirms save-and-load. The current Memory and its previous snapshot are persisted with the Book and included in complete JSON export.

Model-generated memory is never inserted into ordinary continuation until it is confirmed. Hosted/device generation remains Fake, and there is no automatic cloud storage or synchronization. Provider keys and endpoints remain a trust boundary: only enter a temporary device test key when you trust the current page and destination URL; local-host keys are stored as described above.

## Current limits

- A Book `PUT` request is limited to 1 MB, and autosave currently writes the whole Book. A future Section/source revision API is outlined in [`docs/INCREMENTAL_SAVE.md`](docs/INCREMENTAL_SAVE.md); it is not implemented.
- Browser `localStorage` is not encrypted and is readable by same-origin scripts. Clearing site data deletes device-local Books.
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

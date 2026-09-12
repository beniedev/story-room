# Privacy

Story Room is an early Alpha for local-first writing. The user installation runs a local Node service. It does not provide cloud manuscript storage, account sync, telemetry, or an automatic synchronization service. A separate hosted/device build is retained for internal screenshots and regression checks; its data behavior is described below.

## Local host

The local Node host writes Book data as readable files under `STORY_DATA_DIR` (default `.data/`). When another device accesses that service, Books remain on the computer running it. The local-host Provider configuration is a separate plaintext file (default `.data/private/providers.json`, or `STORY_PROVIDER_CONFIG`). It may contain an OpenAI-compatible API Key and is not part of the Book manifest or JSON backup. The page handles a key when you enter it, but the app does not persist local-host keys in browser storage.

When you use an OpenAI-compatible Provider, the host assembles the request and sends its internal Provider messages to the endpoint you configured. This can include selected manuscript text, writing guidance, character and world material, and confirmed, eligible Section Memory summaries of selected earlier sections. The request also contains Book, chapter, and section titles and positions that identify the writing target. Generating a section summary sends the material selected for that summary request to the configured Provider as well. Check the context overview before generation and use a service you trust.

The legacy `Book.summaries` and `Book.canonFacts` fields are retained in Book storage and exports but are not loaded as sources by the current context planner. They are distinct from `Section.memory` and its confirmed earlier-section summaries, which can be sent as described above. A statement about legacy fields remaining local does not mean that all summaries stay on the device.

The browser receives a compact context preview or the generated draft; it does not receive or display raw Provider messages. The host does not choose a third-party sync destination. Provider responses are used for the current generation and are not a cloud backup.

The browser document title is always the generic `故事书屋 · Story Room`; it does not include a Book, chapter, or Section name, and the app URL does not include those names. This reduces accidental exposure in a tab or history entry, but does not prevent the browser, operating system, or other software with access to them from revealing local activity.

## Internal hosted/device build

The hosted/device build stores its Book library in the current browser's unencrypted `localStorage`. Any script running with the same origin can read it. Clearing site data removes that device-local library. The app does not upload Books to a cloud backend.

Per-tab recovery drafts use `sessionStorage`. They can restore saved recovery drafts after a refresh in the same tab, but retention after the tab session ends is not a reliable guarantee. Unsent input and unconfirmed editor contents are not necessarily included in these drafts or Book backups. IndexedDB is used only to coordinate writes; it does not store manuscripts or give `localStorage` transactional rollback. Device storage does not provide the local host's file-transaction recovery.

Generation in this runtime is Fake. The Provider test form can send a temporary key entered on the page directly to the URL you enter. The current page's scripts can read that runtime input; the app does not persist the key.

## Exports and deletion

The complete JSON export includes the current Book's manuscript, interaction blocks, retained candidates, branches, Book settings, prompt-loading scope, and Section Memory data, including a previous Memory snapshot when present. It does not promise to capture unsent input, unconfirmed previous-text drafts, or all open editor contents. Preserve those separately before leaving or reloading. EPUB, Markdown, and TXT exports also contain story content. Treat exports as sensitive files and delete or protect them using your operating system's controls.

Deleting a Book from the local host removes its Book directory, including its persisted Memory data, after the library update. Deleting site data removes hosted/device Books. The app cannot delete copies you exported or copied elsewhere.

## What this document does not promise

Browser storage, the operating system, local files, the network, and a configured Provider endpoint may be inspected or compromised by software with access to them. This Alpha does not provide encryption at rest, cloud access controls, multi-user isolation beyond Book-level application checks, or a guarantee against endpoint logging.

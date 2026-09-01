# ADR 0001: Local-host web demo

Status: accepted for the pre-release demo.

## Decision

Use one Node + TypeScript host and one React/Vite interface. In local-host mode, the host owns the readable Book directory and prompt assembly. It supports the deterministic Fake Provider and an OpenAI-compatible Provider endpoint selected by the user. The host Provider configuration keeps API Keys in a plaintext file outside the Book manifest.

In the hosted/device build, the current browser owns its Book data in unencrypted device-local storage. Generation remains Fake, and no manuscript is sent to or persisted by a cloud backend. A Provider test may send a temporary key from the current page directly to the URL entered by the user; the page can read that input while it is running.

Author and character modes use the same writing pipeline. Character mode adds a selected in-Book character, first-person viewpoint, and narrower user authority. Prompt plans expose ordered Provider-input blocks and provenance without claiming to expose model reasoning.

The local host defaults to `127.0.0.1` and accepts an explicitly configured LAN or private-network bind address. It does not add an access-password, token, or Host allowlist. State-changing browser requests with an `Origin` header must be same-origin. `STORY_ALLOW_PRIVATE_PROVIDERS=1` is an explicit HTTPS private-network Provider opt-in; metadata, link-local, and redirect targets remain blocked.

## Consequences

- Desktop and phone browsers use the same interface.
- The local path needs no Electron, Tauri, Capacitor, database, account system, or cloud sync service.
- The hosted/device path keeps Books in the current browser only. Users export EPUB, Markdown, TXT, or complete JSON and choose their own file synchronization method.
- Host Book files remain readable and Book-scoped. The host no longer uses full-Book `localStorage` caches; the hosted/device path retains its existing browser-local behavior.
- A Book request is limited to 1 MB and autosave currently writes the whole Book. Incremental Section/source revisions are future work, not part of this ADR's implementation.
- This design is a pre-release demo. It does not make a LAN binding safe for public exposure or replace browser, operating-system, filesystem, or Provider endpoint security.

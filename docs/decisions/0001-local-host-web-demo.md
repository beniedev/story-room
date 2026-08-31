# ADR 0001: Local-host Web DEMO

Status: accepted for the initial DEMO.

## Decision

Use one Node + TypeScript host and a React/Vite web interface. In local-host mode, the host owns readable manuscript files and prompt assembly. In the hosted DEMO, the current browser owns its Book data in device-local storage; no manuscript is sent to or persisted by a cloud backend.

Author and character modes use the same writing pipeline. Character mode adds a selected in-Book character, first-person viewpoint, and narrower user authority. Prompt plans expose ordered provider-input blocks and provenance without claiming to expose model reasoning.

## Consequences

- Desktop and phone browsers can use the same interface.
- The first DEMO needs no Electron, Tauri, Capacitor, database, account system, or real Provider.
- The hosted DEMO does not sync Books between browsers or devices. Users export EPUB, Markdown, TXT, or complete JSON and choose their own file synchronization method.
- Loopback is the default. Private-network binding is explicit and remains development-only until access control exists.
- Story files stay readable and Book-scoped; cross-Book context injection is a test failure.

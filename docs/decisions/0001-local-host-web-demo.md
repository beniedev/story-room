# ADR 0001: Local-host Web DEMO

Status: accepted for the initial DEMO.

## Decision

Use one Node + TypeScript host and a React/Vite web interface. The host owns manuscript files and prompt assembly. Browsers hold only interface preferences.

Author and character modes use the same writing pipeline. Character mode adds a selected in-Book character, first-person viewpoint, and narrower user authority. Prompt plans expose ordered provider-input blocks and provenance without claiming to expose model reasoning.

## Consequences

- Desktop and phone browsers can use the same interface.
- The first DEMO needs no Electron, Tauri, Capacitor, database, account system, or real Provider.
- Loopback is the default. Private-network binding is explicit and remains development-only until access control exists.
- Story files stay readable and Book-scoped; cross-Book context injection is a test failure.

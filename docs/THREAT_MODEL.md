# Threat model

This document describes the trust boundaries of the pre-release local-first demo. It is a review aid, not a production security claim.

## Mental model and assets

The local Node host writes a readable Book directory. The hosted/device build keeps the current Book in the browser. The main assets are:

- manuscript text, interaction blocks, branches, source settings, Section Memory snapshots, and complete exports;
- local-host Provider configuration and its API Key;
- a temporary Provider test key entered in the hosted/device page;
- Provider request and response contents.

## Trust boundaries

| Boundary | Trusted by the app | Not trusted or not controlled |
| --- | --- | --- |
| Browser/device | The current page can use its runtime storage and request the local host | Same-origin scripts, browser extensions, browser profile, and device malware can inspect browser data |
| Local host/filesystem | The configured data directory and Book-scoped file layout | Filesystem changes outside the process, stale links, malformed files, and exported copies |
| Provider endpoint | The URL and response are selected by the user and checked by the host | Endpoint operators, endpoint logs, returned content, and any compromise after the check |
| Host entry | The maintainer chooses the bind address and trusts devices that can reach it | Network exposure, observers, and other users on the selected network |

## Current controls

- Book paths are validated and Book content is not combined across IDs.
- Local-host saves publish content before `book.json`, reconcile managed files, and update the library only after cleanup succeeds.
- Local-host full-Book browser caches are not used; legacy `story-native:book:` entries are cleared on host startup. Device-local storage remains unencrypted by design.
- The host and development launcher default to loopback and accept an explicitly configured LAN or private-network bind address. They do not add a password/token gate or Host allowlist. State-changing requests with an Origin header require same-origin.
- Provider URLs reject credentials, validate every resolved address before each request, require HTTPS except for loopback HTTP, keep private-network access opt-in, reject metadata/link-local targets, and use manual redirect handling.
- Provider request and response bodies are bounded. Local-host Provider Keys are kept in a plaintext config file; POSIX writes use mode `0600`.
- The hosted/device Provider test sends a temporary key directly to the entered endpoint and does not persist it.

## Residual risks

- DNS preflight and the actual connection are separate operations. A theoretical DNS/routing TOCTOU can still change the destination after validation.
- An attacker who controls the browser, a same-origin script, the operating system, the data directory, the local network, or the configured endpoint can read or alter data within that boundary.
- Browser `localStorage` is not encrypted. Site-data clearing, browser profile loss, or user deletion can remove device-local Books. Exports are outside the app's control.
- The local host uses HTTP and is not a hardened public service. Binding it to a reachable address does not add TLS, user accounts, rate limiting, or multi-user authorization.
- Full Book `PUT` and autosave remain whole-Book operations with a 1 MB request limit. Incremental revisions are future work described in [`INCREMENTAL_SAVE.md`](INCREMENTAL_SAVE.md).

## Out of scope

This demo does not attempt to secure a compromised browser or operating system, prove Provider confidentiality, offer cloud synchronization, provide production LAN authentication, or guarantee that a third-party endpoint will not retain prompts and responses.

# Security policy

Story-native Writing Harness is a pre-release, non-production demo. It is designed for a local host or a single browser device, not for public hosting or multi-user data.

## Report a vulnerability

Please use the repository's GitHub **Security → Advisories → New draft security advisory** page for a private report. Do not include API Keys, access tokens, cookies, private story text, exported Books, or other live data in an issue or patch. Use the synthetic fixtures and placeholder endpoints from the repository when a reproduction needs data.

## Security boundaries

The important assets are:

- Book files and exports, including manuscript text, blocks, branches, source material, and Section Memory snapshots;
- local-host Provider configuration and API Keys;
- temporary Provider test keys entered in a hosted/device page.

The local host defaults to `127.0.0.1` and may bind to an explicitly configured LAN or private-network address. It has no access-password, token, or Host allowlist, so any device that can reach that address can use it. State-changing requests with an `Origin` header must match the request Host. This is a deployment choice, not a production service or a guarantee of network security.

Provider requests validate the URL and all DNS results before each request. Public HTTP is rejected, HTTPS private-network access requires `STORY_ALLOW_PRIVATE_PROVIDERS=1`, metadata and link-local targets remain rejected, and redirects are not followed. Local-host Provider Keys are stored as plaintext in the configured Provider file; POSIX writes use mode `0600`, while Windows permissions are not treated as an equivalent credential store.

The hosted/device build keeps Books in unencrypted browser `localStorage`. Same-origin scripts can read that storage, and clearing site data removes the device-local library. A hosted/device Provider test sends its temporary key directly to the entered URL; the page can read it while it is running and the app does not persist it.

The prompt view is limited to a compact Provider-input preview: it shows categories, approximate budget, and any explicit exclusion or degradation. It does not expose raw Provider messages or hidden model reasoning, and stored Book summaries or Canon facts are not silently added as prompt material. The context-plan API returns preview metadata and the generation API returns the draft without echoing the full internal plan.

## Known limitations

- Provider DNS preflight and the subsequent network connection are separate operations, so a theoretical DNS or routing TOCTOU remains.
- A compromised browser, same-origin script, operating system, filesystem, or configured Provider endpoint is outside the guarantees of this demo.
- The local HTTP host is not a hardened production service. Do not use it as a public internet endpoint.
- Full Book `PUT` requests are limited to 1 MB and current autosave writes the whole Book. See [`docs/INCREMENTAL_SAVE.md`](docs/INCREMENTAL_SAVE.md) for an unimplemented future design.

Security checks in CI are evidence about the repository and test environment. They are not a production certification or a promise of deployment safety.

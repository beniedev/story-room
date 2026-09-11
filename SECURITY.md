# Security policy

Story Room is a pre-release, non-production demo. It is designed for a local host or a single browser device, not for public hosting or multi-user data.

## Report a vulnerability

Please use the repository's GitHub **Security → Advisories → New draft security advisory** page for a private report. Do not include API Keys, access tokens, cookies, private story text, exported Books, or other live data in an issue or patch. Use the synthetic fixtures and placeholder endpoints from the repository when a reproduction needs data.

## Security boundaries

The important assets are:

- Book files and exports, including manuscript text, blocks, branches, source material, and Section Memory snapshots;
- local-host Provider configuration and API Keys;
- temporary Provider test keys entered in a hosted/device page.

The local host defaults to `127.0.0.1` and may bind to an explicitly configured LAN or private-network address. It has no access-password, token, or Host allowlist, so any device that can reach that address can use it. State-changing requests with an `Origin` header must match the request Host. This is a deployment choice, not a production service or a guarantee of network security.

Provider requests validate the URL and all DNS results before each request. User-configured HTTP and HTTPS endpoints are accepted on public and private networks without an extra opt-in flag. Metadata and link-local targets remain rejected, and redirects are not followed. Local-host Provider Keys are stored as plaintext in the configured Provider file; POSIX writes use mode `0600`, while Windows permissions are not treated as an equivalent credential store.

The hosted/device build keeps Books in unencrypted browser `localStorage`. Same-origin scripts can read that storage, and clearing site data removes the device-local library. A hosted/device Provider test sends its temporary key directly to the entered URL; the page can read it while it is running and the app does not persist it.

The prompt view is limited to a compact Provider-input preview: it shows categories, approximate budget, and any explicit exclusion or degradation. It does not expose raw Provider messages or hidden model reasoning, and stored Book summaries or Canon facts are not silently added as prompt material. The context-plan API returns preview metadata and the generation API returns the draft without echoing the full internal plan.

Local-host Book saves use an expected `updatedAt` revision and reject stale updates with HTTP 409. Before publishing a save, the store snapshots its managed Book files and library index under a private transaction journal. Book deletion first moves the complete Book tree into that private recovery area, then updates the library and records the commit before physical cleanup. After an interruption, prepared saves and deletions are rolled back; committed saves are retained and committed deletions finish cleanup. JSON backup imports are validated and assigned a new Book ID rather than replacing an existing Book.

## Known limitations

- Provider DNS preflight and the subsequent network connection are separate operations, so a theoretical DNS or routing TOCTOU remains.
- A compromised browser, same-origin script, operating system, filesystem, or configured Provider endpoint is outside the guarantees of this demo.
- The local HTTP host is not a hardened production service. Do not use it as a public internet endpoint.
- The storage queue and transaction recovery belong to one host process; there is no cross-process file lock. Do not run independent hosts against the same data directory.
- Transaction recovery handles host-process interruption after filesystem operations become visible; it does not `fsync` every file and directory and is not a guarantee against sudden power loss, storage failure, or disk corruption. Keep independent backups.
- Browser `localStorage` does not provide the local host's multi-file transaction recovery. Same-origin storage events are best-effort conflict signals, not synchronization or merging.
- Full Book `PUT` requests have no application-defined size cap. Saves still transfer and validate the whole Book; unchanged source and manuscript files are not rewritten. See [`docs/INCREMENTAL_SAVE.md`](docs/INCREMENTAL_SAVE.md) for an unimplemented future API design.

## Repository checks

CI runs dependency auditing and license checks separately from secret scanning and the repository privacy scan. The privacy job fetches every repository head and tag, verifies the checksum of a pinned Gitleaks release, and scans all commits reachable from those refs with explicit `--all` history options. The current-tree privacy scan still runs when Gitleaks reports a finding, and a failed dependency audit does not prevent the privacy job from running. Each check reports its own failure without suppressing another check's findings.

Temporary mitigation: `package.json` overrides only Miniflare's `sharp` dependency to `0.35.4`, which fixes [GHSA-rgj7-g3m4-5g8c](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c). Miniflare currently pins an affected version. This uses the upstream patch release without changing the rest of the toolchain. Because it selects a native package, verify platform compatibility when changing the override. Remove it when the selected Miniflare version brings in a patched `sharp` itself, then rerun installation, dependency auditing, tests and both builds.

Security checks in CI are evidence about the repository and test environment. They are not a production certification or a promise of deployment safety.

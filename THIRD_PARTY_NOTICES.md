# Third-party notices

The versions below are the locally confirmed package versions in `package-lock.json`. License metadata is checked for direct dependencies by `npm run license:check`.

| Package | Version | License metadata |
| --- | ---: | --- |
| `fflate` | 0.8.3 | MIT |
| `lucide-react` | 1.37.0 | ISC |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `@cloudflare/vite-plugin` | 1.54.2 | MIT |
| `vite` | 8.2.2 | MIT |
| `vitest` | 4.1.11 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `wrangler` | 4.127.1 | MIT OR Apache-2.0 |

## Allowlisted binary assets

`npm run privacy:scan` accepts only the following repository binaries. Each hash is a fixed SHA-256 recorded in `scripts/privacy-scan.mjs`; a new or changed binary fails closed until its path, hash, format checks, and notice entry are reviewed.

| Asset | Format | SHA-256 |
| --- | --- | --- |
| `assets/fonts/LXGWWenKaiLite-Regular.ttf.br` | Brotli-compressed TrueType font | `b3eb68cfb287957f43c8752dcac219a144b41306d71b2b46cdf3dbc2f89e126a` |

The scanner decompresses the bundled font to inspect its `name` table. The generated `public/fonts/LXGWWenKaiLite-Regular.ttf` is derived from the allowlisted Brotli source during preparation and remains ignored by Git.

## Bundled font

`public/fonts/OFL.txt` records the SIL Open Font License 1.1 for the bundled LXGW WenKai Lite font. The fixed SHA-256 above identifies the exact font artifact distributed by this repository.

This file records repository metadata only. It does not replace the license text shipped with a dependency or asset.

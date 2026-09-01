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
| `public/icons/apple-icon-57x57.png` | PNG | `10eae804d2e5d289552e73337084cf6af38ef79a3b6917ba0ad8922a161e63f6` |
| `public/icons/apple-icon-72x72.png` | PNG | `5cdf8d43db49ffc00efe4e8076414da34a0f3a0604955acf4507a9570fb5140c` |
| `public/icons/apple-icon-114x114.png` | PNG | `844e78300180b904b3b27493263d00d149dab8d46ab51db6dfbc9fc662a2bcee` |
| `public/icons/apple-icon-144x144.png` | PNG | `daf5373ebe1af2d7463fce26e64e92285410212b809d7a5b4c9a51fd47323e50` |
| `public/icons/apple-icon-192x192.png` | PNG | `f836bab8263c21e279ba489cce0554d0e25014fbac4e8f38f722c0b80580f63e` |
| `public/icons/apple-icon-512x512.png` | PNG | `86b85c728ca97eccf8d59b5e6a2819a5119406fa5288945310ed456c3e16d786` |
| `public/icons/favicon.ico` | ICO with four embedded PNG entries | `05eb23508b4cb8e6a917eab4d6a41ace7ca12b76a21654a8a64ffa69ed21ee38` |

The scanner parses PNG text metadata chunks, validates every ICO image entry, and decompresses the bundled font to inspect its `name` table. The generated `public/fonts/LXGWWenKaiLite-Regular.ttf` is derived from the allowlisted Brotli source during preparation and remains ignored by Git.

## Bundled assets requiring owner confirmation

- `public/fonts/OFL.txt` records the SIL Open Font License 1.1 for the bundled LXGW WenKai Lite font. The repository does not record the exact upstream revision; the owner must confirm that revision before a public release.
- `public/icons/` contains custom icon assets. Their source and ownership are not verified in this repository. Public distribution is blocked until the owner confirms provenance and licensing.

This file records repository metadata only. It does not replace the license text shipped with a dependency or asset.

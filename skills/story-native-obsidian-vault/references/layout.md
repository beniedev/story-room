# Vault layout and field mapping

The generated vault is intentionally ordinary Markdown:

```text
Index.md
Book.md
Guides/
Characters/
World/
Canon/
State/Summaries/
Chapters/<number>-<chapter>/<number>-<section>.md
.story-native/book.json
AGENTS.md
```

`Index.md` is the navigation entry. Each generated content file has flat YAML properties using the `story-native-*` prefix. Stable IDs, not filenames, are the identity boundary; titles and filenames may change without changing identity.

| Story Native field | Vault location |
| --- | --- |
| Book title and metadata | `Book.md` |
| `writingBrief` | `Guides/Writing-Style.md` |
| `plotOutline` | `Guides/Plot-Outline.md` |
| `characters` | `Characters/*.md` |
| `worldRules` | `World/*.md` |
| `canonFacts` | `Canon/*.md` |
| `summaries` | `State/Summaries/*.md` |
| `chapters[].sections[]` | `Chapters/*/*.md` |
| Complete source object, including blocks and branches | `.story-native/book.json` |

`includeInPrompt` and `loadedSectionIds` are preserved as properties. An absent `loadedSectionIds` means all sections; an empty array means no sections. Do not collapse those states.

The visible section Markdown contains continuous manuscript prose. Interaction-block boundaries remain available in the lossless JSON backup instead of being rendered as chat bubbles.

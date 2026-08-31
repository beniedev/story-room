---
name: story-native-obsidian-vault
description: Convert a Story Native JSON book export into a readable Obsidian vault while preserving Book isolation, stable IDs, prompt-loading metadata, and the original lossless backup. Use when a user asks to move or organize a Story Native book in Obsidian; do not use for generic Markdown folders unrelated to Story Native exports.
---

# Story Native Obsidian Vault

Create a new vault from one Story Native JSON export. The user owns the destination and its synchronization method; this skill must not upload, sync, merge into an existing vault, or overwrite files without separate authorization.

## Default workflow

1. Confirm the input is a Story Native `.json` export and resolve the intended output directory.
2. Refuse a non-empty output directory. Never treat conversion approval as permission to replace an existing vault.
3. Run:

   ```bash
   python <skill-directory>/scripts/story_native_to_obsidian.py <book.json> <new-vault-directory>
   ```

4. Inspect `Index.md`, two representative content files, and `.story-native/book.json`. Check that titles, stable IDs, chapter order, and non-Latin text survived.
5. Report the created vault path and note that interaction blocks and branches remain in the lossless backup. Do not open, sync, commit, or upload it unless the user requested that action.

The converter produces plain Markdown plus an unmodified JSON backup. Obsidian can open the resulting folder directly as a vault; creating or copying `.obsidian` settings is unnecessary.

## Existing vaults

Do not run the converter directly over an existing vault. Convert into a new sibling directory, compare the two trees, then ask the user before merging. Preserve any existing `AGENTS.md`, `.obsidian`, links, properties, and naming conventions.

Read [references/layout.md](references/layout.md) only when adapting the generated layout, mapping fields manually, or reviewing another converter.

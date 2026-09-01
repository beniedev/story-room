# ADR 0002: Context planner contracts

Status: accepted for the pre-release demo.

## Decision

- `MANUSCRIPT` is the primary source of facts. `MEMORY` is a lossy index, so manuscript text wins when they conflict.
- Legacy Section `plan` and `note` fields remain readable and exportable for compatibility only; they are not injected into Provider prompts. A reference is completed, non-target material.
- Book-level summaries and Canon facts remain stored/exportable Book data, but are not implicit Provider prompt inputs.
- Each generation request uses one `system` message for the static contract and one structured `user` packet for the selected Book data and turn input. Story strings are JSON-encoded inside that packet.
- Prompt blocks use three Planner stability groups/cache hints, not Provider cache controls or cache-hit guarantees: `stable` for the fixed system contract and Book-level material explicitly included by the planner, `session` for the selected mode and references, and `dynamic` for the current target, author note, and turn input. These bands describe cache behavior only; they are not story state.
- Summary references require a fresh Section Memory whose provenance is `manual`, `model-confirmed`, or `model-edited`. The full Section used to create a summary is not silently truncated for summary generation. The target Section is never silently trimmed; if the request exceeds the available input budget, planning reports the overflow and generation does not proceed.
- The prompt overview renders the actual `{ role, content }` messages for the request, with an approximate budget and explicit exclusion/degradation state. It does not claim to expose hidden model reasoning.

## Deliberate boundaries

This planner does not add RAG, embeddings, or Book-level thread state. Memory remains a local, structured, manually confirmed context aid; it does not become Canon automatically. The current Memory and its previous snapshot are local Book state and are included in complete JSON export; rollback swaps the snapshots and permanent clear removes the selected data. The Provider adapter receives only standard `{ role, content }` messages, while the UI shows those messages and their inclusion state.

## Consequences

The target, references, and turn input remain distinguishable in both the plan metadata and the structured packet. Invalid, stale, or unavailable references are surfaced with a reason instead of being silently downgraded to another mode. Model-generated Memory drafts are not used for ordinary continuation until confirmed. Token estimates are approximate and visible as such; full-Book autosave remains a separate boundary described in the incremental-save design.

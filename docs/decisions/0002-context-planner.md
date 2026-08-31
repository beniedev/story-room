# ADR 0002: Context planner contracts

Status: accepted for the pre-release demo.

## Decision

- `MANUSCRIPT` is the primary source of facts. `MEMORY` is a lossy index, so manuscript text wins when they conflict.
- A Section Plan is a future plan, not an event that already happened. A reference is completed, non-target material.
- Each generation request uses one `system` message for the static contract and one structured `user` packet for the selected Book data and turn input. Story strings are JSON-encoded inside that packet.
- Prompt blocks use three Planner stability groups/cache hints, not Provider cache controls or cache-hit guarantees: `stable` for the fixed system contract and Book-level material, `session` for the selected mode and references, and `dynamic` for the current target, note, and turn input. These bands describe cache behavior only; they are not story state.
- Summary references require a fresh Section Memory whose provenance is `manual`, `model-confirmed`, or `model-edited`. The full Section used to create a summary is not silently truncated for summary generation. Continuation may retain only the target Section's tail when the input budget requires it, and marks that truncation.

## Deliberate boundaries

This planner does not add RAG, embeddings, or Book-level thread state. Memory remains a local, structured, manually confirmed context aid; it does not become Canon automatically. The Provider adapter receives only standard `{ role, content }` messages, while the UI may show block provenance and the exact input preview.

## Consequences

The target, references, future plan, and turn input remain distinguishable in both the plan metadata and the structured packet. Invalid or unavailable references are excluded with a reason instead of being silently treated as ordinary manuscript. The current implementation still uses approximate token estimates and full-Book autosave; see the existing incremental-save design for that separate boundary.

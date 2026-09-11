# ADR 0002: Context planner contracts

Status: accepted for the pre-release demo.

## Decision

- `MANUSCRIPT` is the primary source of facts. `MEMORY` is a lossy index, so manuscript text wins when they conflict.
- Legacy Section `plan` data remains readable and exportable for compatibility only; it is not injected into Provider prompts. The current Section `note` is persistent writing guidance and is included in non-summary prompts for that Section, while notes from other Sections remain excluded. A reference is completed, non-target material.
- Book-level summaries and Canon facts remain stored/exportable Book data, but are not implicit Provider prompt inputs.
- Each generation request uses one `system` message for the static contract and one structured `user` packet for the selected Book data and turn input. Story strings are JSON-encoded inside that packet.
- Prompt blocks use three Planner stability groups/cache hints, not Provider cache controls or cache-hit guarantees: `stable` for the fixed system contract and Book-level material explicitly included by the planner, `session` for the selected mode and references, and `dynamic` for the current target, author note, and turn input. These bands describe cache behavior only; they are not story state.
- Summary references require a fresh Section Memory whose provenance is `manual`, `model-confirmed`, or `model-edited`. The full Section used to create a summary is not silently truncated for summary generation. The target Section is never silently trimmed. Planning reports estimated budget overflow as advisory information; generation can proceed and the configured Provider determines its actual limits.
- The prompt overview renders compact Provider-input metadata for the request, with an approximate budget and explicit exclusion/degradation state. It does not display raw `{ role, content }` messages or claim to expose hidden model reasoning. The context-plan API returns preview metadata; the generation API returns the draft and answer source-signature metadata without echoing the internal plan.
- Regenerating an answer uses current manuscript text before its target block; the target answer, alternative candidates, and later passages are excluded. Responding to a final user block includes that user's text once. Candidate arrows immediately select the manuscript version and update its content projection and Memory freshness; saving runs in the background. The next new input's answer must be generated and saved successfully before the preceding answer's alternatives are removed. Failure, cancellation, regeneration, and continuation without new input preserve them.

## Deliberate boundaries

This planner does not add RAG, embeddings, or Book-level thread state. Memory remains a local, structured, manually confirmed context aid; it does not become Canon automatically. The current Memory and its previous snapshot are local Book state and are included in complete JSON export; rollback swaps the snapshots and permanent clear removes the selected data. Answer candidates are local Book data, with only the adopted version entering manuscript context. The Provider adapter receives only standard `{ role, content }` messages, while the UI shows compact inclusion metadata and the API returns preview/draft and source-signature data.

## Consequences

The target, references, and turn input remain distinguishable in both the plan metadata and the structured packet. Invalid, stale, or unavailable references are surfaced with a reason instead of being silently downgraded to another mode. Model-generated Memory drafts are not used for ordinary continuation until confirmed. Token estimates are approximate and visible as such; full-Book autosave remains a separate boundary described in the incremental-save design.

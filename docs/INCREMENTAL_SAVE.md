# Incremental save design (future work)

This is a design note, not an implemented incremental API. The current host accepts a whole-Book `PUT` without an application-defined size cap. That request includes the `updatedAt` revision the client loaded; the host checks it inside a process-local queue and rejects stale saves. Before publishing the managed files, manifest, and library index, the host snapshots the previous managed state under a recoverable transaction journal. The client also reuses saves of the same unchanged in-page revision, and the host skips rewriting unchanged source and manuscript files. Requests and validation still cover the whole Book. Large Books still cost more memory and I/O to save, and edits that have not reached a successful save still need an independent backup.

## Goal

Save only the changed Section or source file while keeping the Book manifest and library consistent. The Book directory remains the persistence boundary, and the current write queue remains the serialization point.

## Proposed contract

1. Read the current Book revision and return a stable revision identifier.
2. Send a revision request containing the Book ID, one Section or source ID, the expected previous revision, and the new content.
3. Write the new content to its managed path, publish the manifest revision, reconcile managed files, and update the library in that order.
4. Reject a stale expected revision without overwriting newer content. Whole-Book saves already reject this case and retain the local page for export or explicit reload; an incremental editor may add a deliberate merge flow.
5. Send only the changed source per revision without imposing an arbitrary content-size cap; keep exports as explicit whole-Book operations.

## Open questions

- Whether the revision should be a monotonic counter, a timestamp-plus-random value, or a content hash;
- how to represent a rename or deletion without making a partial manifest visible;
- whether an incremental conflict UI should add a side-by-side diff or merge flow beyond the current whole-Book reload/export choice;
- how migration should handle existing whole-Book saves and interrupted writes.

Until this incremental design is implemented and tested, callers should treat a save as a whole-Book operation and keep independent exports when the work matters.

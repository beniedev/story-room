# Incremental save design (future work)

This is a design note, not an implemented API. The current host accepts a whole-Book `PUT` without an application-defined size cap and autosaves the whole Book. Large Books still cost more memory and I/O to save; pending edits can be lost before a save succeeds.

## Goal

Save only the changed Section or source file while keeping the Book manifest and library consistent. The Book directory remains the persistence boundary, and the current write queue remains the serialization point.

## Proposed contract

1. Read the current Book revision and return a stable revision identifier.
2. Send a revision request containing the Book ID, one Section or source ID, the expected previous revision, and the new content.
3. Write the new content to its managed path, publish the manifest revision, reconcile managed files, and update the library in that order.
4. Reject a stale expected revision without overwriting newer content. The client reloads and asks the user whether to keep, merge, or discard the local edit.
5. Send only the changed source per revision without imposing an arbitrary content-size cap; keep exports as explicit whole-Book operations.

## Open questions

- Whether the revision should be a monotonic counter, a timestamp-plus-random value, or a content hash;
- how to represent a rename or deletion without making a partial manifest visible;
- whether a conflict UI should show a side-by-side diff or only offer reload/export;
- how migration should handle existing whole-Book saves and interrupted writes.

Until this design is implemented and tested, callers should treat a save as a whole-Book operation and keep independent exports when the work matters.

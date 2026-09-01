# Privacy

Story-native Writing Harness does not provide cloud manuscript storage, account sync, telemetry, or an automatic synchronization service. What is stored or sent depends on the runtime you choose.

## Local host

The local Node host writes Book data as readable files under `STORY_DATA_DIR` (default `.data/`). The local-host Provider configuration is a separate plaintext file (default `.data/private/providers.json`, or `STORY_PROVIDER_CONFIG`). It may contain an OpenAI-compatible API Key and is not part of the Book manifest.

When you use an OpenAI-compatible Provider, the messages shown for the current request are sent to the endpoint you configured. Book summaries and Canon facts remain local Book data and are not hidden prompt inputs. The host does not choose a third-party sync destination. Provider responses are used for the current generation and are not presented as a cloud backup.

The local-host `访问密码` setting is optional and off by default. If you enable it, the current browser tab keeps the entered password for requests; this does not encrypt Book files or turn the host into a multi-user service.

## Hosted/device build

The hosted/device build stores its Book library in the current browser's unencrypted `localStorage`. Any script running with the same origin can read it. Clearing site data removes that device-local library. The app does not upload Books to a cloud backend.

The browser document title is always the generic `故事书架 · Story-native`; it does not include a Book, chapter, or Section name, and the app URL does not include those names. This reduces accidental exposure in a tab or history entry, but does not prevent the browser, operating system, or other software with access to them from revealing local activity.

Generation in this runtime is Fake. The Provider test form can send a temporary key entered on the page directly to the URL you enter. The current page's scripts can read that runtime input; the app does not persist the key.

## Exports and deletion

The complete JSON export includes the manuscript, interaction blocks, branches, Book settings, prompt-loading scope, and Section Memory data, including a previous Memory snapshot when present. EPUB, Markdown, and TXT exports also contain story content. Treat exports as sensitive files and delete or protect them using your operating system's controls.

Deleting a Book from the local host removes its Book directory, including its persisted Memory data, after the library update. Deleting site data removes hosted/device Books. The app cannot delete copies you exported or copied elsewhere.

## What this document does not promise

Browser storage, the operating system, local files, the network, and a configured Provider endpoint may be inspected or compromised by software with access to them. This pre-release demo does not provide encryption at rest, cloud access controls, multi-user isolation beyond Book-level application checks, or a guarantee against endpoint logging.

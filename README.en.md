English | [简体中文](README.md)

# Story Room

A local-first writing space that keeps your manuscript, characters, and worldbuilding together.

Start with a scene or a few lines, ask AI to continue, compare candidates, and keep the version that fits your story. Each book has its own material. Write as the author or choose a character and take part in first person. The manuscript stays in continuous prose for reading and editing.

This is an early **Alpha**, and the interface is currently in Chinese. Try it out, and keep independent backups of work you care about.

## Give the link to your agent

Send this repository link to an AI agent that can read code and work on your computer:

**https://github.com/beniedev/story-room**

The repository points it to an [installation and usage guide](docs/AGENT_GUIDE.md). It can check your system and existing environment, get the code, install dependencies, start the app, and open the page. You do not need to choose a runtime edition or learn terminal commands first.

If you want to be more explicit, send:

> Please install and start https://github.com/beniedev/story-room, then help me connect my AI service, start writing, and keep a backup. Read its AGENTS.md and installation guide first, and preserve my existing manuscripts and configuration.

For the first AI connection, the agent guides you to enter a trusted service's URL, model ID, and API key in the app. Enter the key locally, not in the conversation. Story Room does not include a model service or subscription.

Prefer installing it yourself? Follow [Installation and access](docs/USER_GUIDE.md#installation-and-access). The project uses Node.js **22.x (at least 22.18.0) or 24.x**, with npm.

## A look inside

![Desktop bookshelf, mobile writing, and mobile character settings](docs/images/preview.png)

## Start your first book

1. Choose **新建书目** (New Book), enter a title, and confirm. A new book includes a chapter and section.
2. In **本书设定** (Book settings), add characters, worldbuilding, and a plot outline, and confirm where the material should load.
3. Open a section, write a few lines at the bottom, and choose **发送并续写** (Send and continue). Edit the prose, try **再生成一版** (Regenerate version), and use the candidate arrows to select a version.
4. Use **选择前文** (Select previous text) to save summaries of earlier sections and choose what this section should reference. Check **本轮上下文概览** (Context overview) before generating.
5. Return to the shelf and use **导出当前书目** (Export current Book) to keep a backup.

The [User guide](docs/USER_GUIDE.md) covers controls, author and character modes, directory organization, and recovery. It includes a table of the actual Chinese interface labels. A [Chinese User guide](docs/USER_GUIDE.zh-CN.md) is also available.

## Manuscripts, AI, and backups

Books are readable local files on the computer running the app. **设置 → 保存位置** (Settings → Storage location) shows the library directory. When another device accesses that host over a trusted network, the books still live on the host computer. The app has no cloud manuscript storage or automatic sync.

Generation sends **the material included in the current context** to your configured Provider. Local-first describes manuscript storage; it does not mean real AI requests stay on your device. Keys are stored in a separate local plaintext configuration file, outside book backups.

Submitted manuscript edits save automatically. **Unsent or unconfirmed editor text may not be in the book or its JSON backup.** Check the save status and keep unsubmitted text separately before leaving.

- **EPUB, Markdown, TXT** export the currently adopted prose for reading or further editing.
- **JSON full backup** preserves book material, remaining candidates, previous-text selections, and summary snapshots for recovery. Importing creates a copy without replacing the original book.

Multiple tabs can edit. If the same book encounters a save conflict, the page retains its edits; the app does not automatically merge them or overwrite a newer version. Follow [Saving and recovery](docs/USER_GUIDE.md#automatic-saving-conflicts-and-recovery). Transaction recovery does not replace independent backups.

## Current boundaries and feedback

The local host defaults to this computer only, with no login or access password. For use from other devices, ask your agent to configure access within a trusted network. Any device that can reach the service can use it; do not expose it directly to the public internet.

Save and deletion recovery belong to one service process. They do not guarantee protection against power loss or disk corruption, or coordinate independent services sharing a library. There is no account sync, multi-user collaboration, or desktop installer. CI tests and builds on Windows, macOS, and Ubuntu with Node 22/24; it does not mean every browser or Provider has been tested in use.

Bug reports with small fictional stories are welcome. Do not attach private manuscripts, backups, or keys. Follow [Security](SECURITY.md) for security reports. [Privacy](PRIVACY.md) and the [Threat model](docs/THREAT_MODEL.md) explain data and trust boundaries.

Development checks and code entry points are in the [Agent guide](docs/AGENT_GUIDE.md#verification-entry-points).

## License and third-party assets

Project code uses the [MIT License](LICENSE). The optional LXGW WenKai Lite font uses the [SIL Open Font License 1.1](public/fonts/OFL.txt). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for other attributions.

English | [简体中文](USER_GUIDE.zh-CN.md)

# User Guide

Welcome to Story Room. It keeps the manuscript, characters, worldbuilding, and writing prompts in one Book, so you can quietly write a continuous novel and ask AI to continue for a few paragraphs when you need help. The operation names in this guide are English names for the current Chinese interface; see the **Interface labels** table at the end for the corresponding Chinese labels. The feature is still in Alpha, so keep a JSON backup of important work.

## Get started

From the project directory, run:

~~~bash
npm ci
npm run dev
~~~

Open the local address shown in the terminal. The quick-start instructions and startup details are in [README.en.md](../README.en.md). For a first run, open the example Book or choose **New Book**. The built-in Fake Provider produces deterministic example text, which is useful for learning the shelf, manuscript, and candidate-version workflow.

Story Room has two runtime modes:

| Runtime mode | Where Books are stored | Generation |
| --- | --- | --- |
| Local-host | Readable Book files, by default in <code>.data/</code> | Fake Provider, or an OpenAI-compatible Provider you configure |
| Browser hosted/device | Unencrypted <code>localStorage</code> for the current browser and website origin | Fake generation; Provider settings are for connection testing only |

Books in the browser belong to the current browser, origin, host, and port. Clearing website data deletes those Books. Export JSON before changing browsers or addresses. The application has no cloud Book storage or automatic synchronization.

## Start from the shelf

### Create, switch, and import Books

1. Choose **New Book**, enter a **Book title**, and choose **Confirm creation**. The new Book becomes current.
2. Use **Switch book** to move between existing Books.
3. Choose **Import JSON backup** and select a previously exported JSON file. Import creates a recovery copy and shows a message equivalent to “A recovery copy of … was imported; the original Book was not overwritten.” The original Book is left untouched.
4. Choose **Export current Book** to export an EPUB ebook, Markdown document, TXT plain text, or JSON full backup. EPUB, Markdown, and TXT are useful for reading or continued editing. JSON preserves character cards, settings, load scopes, manuscript structure, candidate versions, and outline history.

The **Manage current Book** menu includes **Rename Book** and **Delete Book**, with a confirmation prompt before deletion. The library may be empty. After deleting the last Book, use **New Book** or **Import JSON backup** to start again. To delete chapters or sections, choose **Organize directory** at the top, select them, then choose **Delete selected content**. Export a backup before this kind of deletion.

### Chapters and sections

A Book consists of chapters and sections:

1. Choose **New chapter** in the shelf toolbar and enter a chapter name.
2. Choose the **New section** button at the end of a chapter row and enter a section name.
3. Click outside the title on a section row to open the manuscript immediately. Click outside the title on a chapter row to expand or collapse the chapter. Each section shows a word count and an estimated token count so you can gauge its size.
4. Click or tap a section title to open its manuscript, or a chapter title to expand or collapse it. Titles wait 300 ms so a quick double-click or double-tap can rename in place without navigating. Other row areas still act immediately. With a directory title focused, Enter or Space performs its primary action; F2 renames immediately.

Renaming shows only an input field: click outside to save changes, or leave editing if the name is unchanged. Enter also saves; Escape restores the original name. Confirming a character through an input method does not submit. Blank names and failed saves show an inline message and keep your input for correction or retry. The small arrow on each chapter changes direction when it expands or collapses.

The manuscript is stored and displayed as continuous fiction. User input and AI output are recorded internally as blocks, while the interface presents them as prose that can be read continuously. It does not turn the novel into chat bubbles or a group-chat timeline.

### Organize the directory

In the normal directory, chapter rows have a **New section** button; section rows have an open arrow only. Rename a title with a quick double-click or double-tap, or focus it and press F2. Choose **Organize directory** at the top to select entries, then choose the **×** in the same position to finish. The delete button appears only in selection mode and becomes available after selecting a chapter or section.

Choose **Organize directory** at the top to select entries for batch deletion. In this mode, six-dot drag handles support mouse or touch dragging to reorder chapters or sections within their current chapter, or move sections between chapters. Empty chapters can also receive sections.

After a successful save, **Undo** restores the most recent move. It restores only the position, keeping later prose edits and title changes. Failed saves leave the old order in place and let you retry.

Directory order is story order. If moving an entry puts an existing reference after its target, the interface shows which sections are affected. The reference is retained but temporarily excluded. Moving it earlier restores its eligibility as previous material; summaries still need to be confirmed and fresh. Choose **Finish organizing** to return to the normal directory.

## Organize the Book's material first

Choose **Book settings** on the shelf to manage material belonging only to the current Book. A Book's characters, worldbuilding, plot, and manuscript are never mixed into another Book automatically.

### Plot outline and writing guidance

Under **Global guidance** you will find **Writing style guidance** and **Plot outline**:

- **Writing style guidance** can describe tone, narration, language habits, and similar preferences.
- **Plot outline** can describe longer-term story direction.

After editing, choose **Save and load**, then confirm with **Confirm save and load**. Before confirmation, edits are only page drafts. After saving, the material enters later generation according to the current Book's load scope. The plot outline also participates in ordinary continuation and **Regenerate version** as future direction.

### Character cards and worldbuilding

Under **Character cards** or **Worldbuilding settings**, choose **New character card** or **New worldbuilding entry**. A character card can contain a character name, character points, and character settings. A worldbuilding entry can contain a setting name and setting content.

Choose **Select** in either list to select multiple items, then choose the **×** in the same position to finish. The delete button appears only in selection mode and becomes available after selecting an item. Deletion requires confirmation.

In selection mode, each character card or worldbuilding entry also has a six-dot drag handle. Drag one item within its own list to reorder it; the new order saves automatically. Each handle supports mouse or touch dragging; focus it and press Arrow Up or Arrow Down to move one item at a time, and press Escape to cancel an in-progress drag. Group dragging and **Undo** are not supported.

Each material item has a load-scope control:

1. Choose **Load character card** or **Load worldbuilding setting**.
2. On the load page, select the chapters and sections that should use it. You can also choose **Select all**.
3. Choose the confirmation icon and complete **Confirm load** in the confirmation dialog.

Sections you did not select will not load the material. The load scope is part of the Book data and is saved in a JSON full backup.

## Write in the manuscript

Open a section to enter the manuscript editor. The top bar includes:

- **Book settings**: return to the current Book's material.
- **Select previous text**: choose earlier summaries to use for this section's generation.
- **Settings**: adjust display, streaming output, and model connections.

The chapter and section titles below the toolbar support the same double-click, double-tap, and keyboard editing as the directory, with the same save behavior.

### Author mode and character mode

The **Writing actions** menu at the bottom has two modes:

- **Author mode — Continue writing**: you decide the narrative direction, and AI continues from the current manuscript.
- **Character mode — First person**: first choose a **Character to play**, then move the scene forward through that character's first-person action, dialogue, or choice. AI handles the world and other characters; character mode narrows the viewpoint and authority for that generation.

Character mode requires a character from the current Book. With no character selected, the page explains that you must choose one before sending. Both modes share the same save, context, Provider, and apply-result pipeline.

**Writing actions** also lets you edit the **Section note**. It is useful for directions such as “Skip the journey and write the reunion after arrival.” It does not enter the manuscript directly. Changes are retained and take effect in both author mode and character mode.

### Edit manuscript blocks

Choose a block in the manuscript to select it:

- User input can be edited or deleted.
- AI output can be edited, deleted, or regenerated as a new version.
- The edit page shows **Edit user input** or **Edit AI output**. Choose **Done** when finished; the change uses the same automatic save flow as ordinary manuscript edits.
- If the selected AI output has multiple candidates, deletion lets you keep one version or delete the entire block and all candidates.

The manuscript remains continuous prose. Blocks help you locate input, answers, and candidate versions; they do not turn the novel into a chat transcript.

Double-click prose to use the browser's word selection. Dragging text or holding to copy does not also select a manuscript block. The separate block-selection control is available when you want to select a block explicitly, including with a keyboard.

## Generate, regenerate, and manage candidate versions

Enter what you want AI to process next in the input box at the bottom, then choose **Send and continue writing**. Author mode asks AI to write the next paragraph from that point. Character mode asks for an action, dialogue, or choice.

If the current section already ends with a user-input block, **Generate answer** appears below it. Choosing it generates an answer for that block without copying the same user input again.

When you use **Regenerate version** on an existing AI output, the new candidate is generated from the manuscript before that answer and the version currently adopted there. The target answer, its old candidates, and later manuscript text are not silently included in the request. After a successful generation, the new version automatically becomes current and a message explains that a new answer was generated and selected.

When multiple versions exist, the candidate bar shows **Browse AI answer candidates**, a version count, **Previous version**, and **Next version**. The left and right arrows immediately switch the adopted version and save it automatically; they do not call AI again. The adopted version is used for later generation, ordinary exports, and outline-freshness checks.

Candidates are saved with the Book and remain available after refresh. Later, if you enter new user content and the new answer saves successfully, the previous answer keeps only the version that was adopted at that time. If generation fails or is canceled, or if you only continue generation without new user input, existing candidates remain. Switching a candidate in the middle of the manuscript does not delete paragraphs that follow it, so check the transition after switching.

## Streaming output and cancellation

Open **Settings**, then under **Generation** enable **Streaming output**. It is off by default and is saved in the current browser's display preferences.

- With streaming enabled, manuscript generation gradually shows temporary text.
- A notice says that the text is being generated incrementally and has not been written to the manuscript.
- After choosing **Cancel generation**, the draft is not written to the Book. The page temporarily keeps the text so you can choose whether to copy it.
- A failed generation also does not write incomplete text to the manuscript. Starting another generation or reloading the page replaces or clears this temporary preview.
- Outline generation requires a complete structured result and does not use the manuscript's streaming display.

Cancellation only stops Story Room from applying a late result to the manuscript. A request already sent to your configured service may still be recorded or processed by that service.

## Select previous text and save summaries

**Select previous text** lets you choose sections before the current section and also shows existing references made temporarily unavailable by directory moves. It separates choosing what to load from confirming a change to the generation context, so merely expanding an entry does not alter that context:

1. Select the earlier material to reference. Choose a section title to expand or collapse its summary.
2. If a summary does not exist, type one in **Enter this section's summary…**, or choose **Generate section summary**. AI-generated text first stays in the edit box as a draft and is not written to the Book until you confirm saving.
3. After checking the selection, choose **Save and load summary**, then confirm in the dialog. With no selection, confirmation clears the current section's previous-text references, while the original earlier text and existing summaries remain.
4. A red unsaved-changes note appears below each previous-section name with pending edits and disappears after a successful save. Click outside the drawer or use its close button to leave. Pending selections and summary edits remain unapplied but stay in this page session; reopen the drawer, or return after switching sections, to continue editing.

This draft has not been saved to the Book, does not change the context or its token estimate, and does not survive a page reload. Pending changes are included in the page's unsaved-work reminder when you leave. References made unavailable by a move are listed separately; keep them selected or explicitly deselect them. Confirmation does not silently remove them.

Saved summaries are included as summary references for selected earlier sections; Story Room does not automatically load the full earlier manuscript. Internally, each summary is stored as structured <code>Section Memory</code> with a current version and a previous snapshot. Editing the manuscript can make an older summary stale, in which case you should review or regenerate it.

The **Context overview** at the top of the manuscript page shows the approximate Provider, model, word/token budget, and which materials were included and why. It is a summary for checking your selection. It does not show raw Provider messages or hidden model reasoning.

## Configure a Provider

Choose **Settings** and open **Model connections**. First choose **New connection profile**, then fill in:

- **Profile name**
- **API Key**
- **URL**
- **Model ID**
- **Max context** and **Max output**

### Fake Provider and OpenAI-compatible Provider

- Fake Provider is a built-in, deterministic example generator for learning the interface offline.
- Local-host can use Fake Provider or an OpenAI-compatible Provider you trust. Actual generation sends the materials selected by the current context plan to that endpoint.
- Browser hosted/device generation remains Fake. Provider settings on the page can test a connection, but do not turn it into a real generation service.

Choosing **Test** only checks whether <code>/models</code> is reachable and, when a model list is returned, whether it includes the entered Model ID. A successful test does not prove that <code>/chat/completions</code> accepts Story Room's generation parameters.

API Key storage depends on the runtime mode: local-host stores the key in plaintext in the host's Provider configuration file, separate from Books; browser-mode test keys are used only while the current page is running and are not persisted by the application. Enter a real key only when you trust the current page and target URL. Never put a key in a manuscript, JSON backup, example, or issue.

## Display and reading

Display settings in **Settings** are saved in the current browser:

- **Skin**: Blue snow, Pink manga, Grayscale, or Elegant purple.
- **Global font**: Sans-serif or LXGW WenKai.
- **Font size**: adjust with plus and minus buttons. At narrow mobile widths, the manuscript keeps a readable minimum font size.

Open a section to read it as continuous prose. To share it with another reader, choose **Export current Book** on the shelf and select EPUB. To continue editing, choose Markdown. To keep the most compatible plain text, choose TXT. To preserve the complete editing state, choose JSON full backup.

## Automatic saving, conflicts, and recovery

Manuscript edits, block edits, candidate switches, Book material, load scopes, and summary confirmations all use the same Book save pipeline. Ordinary changes automatically save the complete Book.

In local-host mode, if another page saves the same Book first, the page explains that the Book was updated elsewhere and that the current local content is still available for export or reload. In that situation:

1. If you want to keep the current edits, first choose **Export current Book** and select JSON full backup.
2. After confirming the backup, choose **Reload current Book** to read the newest saved version.
3. Story Room does not merge the two manuscripts automatically. Use the backup to decide manually which parts to keep.

Local-host saving has transaction logs and snapshots for process interruption. They are not disk backups and cannot coordinate two independent host processes operating on the same data directory. Keep important work in a JSON backup or another external backup as well.

### Multiple browser tabs

Every tab can edit, including different Books on the same device. Library writes are automatically serialized; there is no editor ownership or takeover step. If two pages edit the same Book, the stale save is rejected and its local text stays available for export or reload. A clean page automatically displays the latest saved version.

If another tab deletes the section being read, this page returns to that Book's directory. Open title inputs, manuscript edits, unsent input, and context drafts are protected before any replacement; the page keeps its current content and reports an update conflict. Preserve those edits before reloading. Unsubmitted input remains in its editor or draft and is not necessarily part of the Book or its JSON backup.

Books persist on the device. Unsaved recovery drafts are isolated in each tab's session storage and survive a reload of that tab. Closing the tab ends its session; confirm that the Book was saved before closing, and export JSON if saving fails. A legacy shared draft is transferred into the first page that opens that Book. Other pages cannot overwrite or clear this page's draft.

Coordination covers one browser storage area and origin. Refresh older tabs after upgrading. Different devices, browser profiles, and independent local hosts do not synchronize automatically.

## Current Alpha boundaries

- There is no cloud storage, account synchronization, multi-user collaboration, RAG, embeddings, or desktop wrapper.
- Browser <code>localStorage</code> is unencrypted and can be read by same-origin scripts. Clearing website data deletes device Books.
- Browser hosted/device mode has no local transaction recovery. Keep JSON backups in a secure location you choose.
- The application does not impose arbitrary limits on manuscript size, API request size, Provider responses, outline items, or candidate counts. Saving still transmits and validates the complete Book. Large Books need more memory and I/O, and the Provider's own context and output limits still apply.
- Context-token estimates are hints. They do not replace the Provider's actual limits, and Story Room does not automatically block sending just because an estimate is slightly over.
- Connection testing verifies <code>/models</code> connectivity and model-list matching only; it is not full generation compatibility testing.
- Web Locks and browser events do not coordinate different origins, browser profiles, devices, or independent local-host processes.

For more data boundaries and issue-reporting guidance, see [SECURITY.md](../SECURITY.md), [PRIVACY.md](../PRIVACY.md), and [THREAT_MODEL.md](THREAT_MODEL.md). If you want an AI agent to explain features or maintain the repository, start with [AGENT_GUIDE.md](AGENT_GUIDE.md).

## Interface labels

The guide uses English operation names for readability. The running interface currently shows these Chinese labels:

| Operation or field in this guide | Current interface label |
| --- | --- |
| New Book | 新建书目 |
| Book title | 书名 |
| Confirm creation | 确认新建 |
| Switch book | 切换书目 |
| Import JSON backup | 导入 JSON 备份 |
| Export current Book | 导出当前书目 |
| EPUB ebook / Markdown document / TXT plain text / JSON full backup | EPUB 电子书 / Markdown 文档 / TXT 纯文字 / JSON 完整备份 |
| Manage current Book | 管理当前书目 |
| Rename Book / Delete Book | 修改书名 / 删除书目 |
| Organize directory / Finish organizing / Delete selected content | 整理目录 / 完成整理目录 / 删除所选内容 |
| Drag to reorder / Undo | 拖动排序 / 撤销 |
| New chapter / Chapter name | 新建章节 / 章节名称 |
| New section / Section name | 新建小节 / 小节名称 |
| Book settings / Select previous text / Settings | 本书设定 / 选择前文 / 设置 |
| Global guidance | 全局指引 |
| Writing style guidance / Plot outline | 写作风格指导 / 剧情大纲 |
| Save and load / Confirm save and load | 保存并加载 / 确认保存并加载 |
| Character cards / Worldbuilding settings | 角色卡 / 世界观设定 |
| New character card / New worldbuilding entry | 新建角色卡 / 新建世界观设定 |
| Character name / Character points / Character settings | 角色名 / 角色要点 / 角色设定 |
| Setting name / Setting content | 设定名称 / 设定内容 |
| Load character card / Load worldbuilding setting / Select all / Confirm load | 加载角色卡 / 加载世界观设定 / 全选 / 确认载入 |
| Writing actions | 写作操作 |
| Author mode — Continue writing / Character mode — First person | 作者模式 · 写作接龙 / 角色模式 · 第一视角 |
| Character to play / Section note | 扮演角色 / 小节注释 |
| Edit / Delete / Regenerate version / Done | 编辑 / 删除 / 再生成一版 / 完成 |
| Edit user input / Edit AI output | 编辑用户输入 / 编辑 AI 输出 |
| Send and continue writing / Generate answer | 发送并续写 / 生成回答 |
| Browse AI answer candidates / Previous version / Next version | 浏览 AI 回答候选 / 上一版 / 下一版 |
| Generation / Streaming output / Cancel generation | 生成 / 流式输出 / 取消生成 |
| Previous text selection | 前文选择 |
| Enter this section's summary… / Generate section summary | 填写这一节的梗概… / 生成该节梗概 |
| Save and load summary / Context overview | 保存并加载梗概 / 本轮上下文概览 |
| Model connections / New connection profile | 模型连接 / 新连接方案 |
| Profile name / API Key / URL / Model ID | 方案名称 / API Key / URL / 模型 ID |
| Max context / Max output / Test | 最大上下文 / 最大输出 / 测试 |
| Skin / Global font / Font size | 皮肤 / 全局字体 / 字号大小 |
| Reload current Book | 重新载入当前书目 |

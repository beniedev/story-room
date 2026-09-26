# 发布说明 / Release notes

## 0.1.0-alpha.2

### 简体中文

第二个 Alpha 汇集了触屏操作、模型响应处理和草稿保护方面的修复，并整理了内部模块边界。当前界面仍为中文。

- **触屏正文操作**：修复手机和平板上轻点后正文操作消失的问题，保留鼠标悬停、点击和触控笔的交互边界。
- **小节注释兼容**：注释作为 assistant 历史消息保留，随后追加 user 正文生成请求，修复部分兼容服务拒绝末尾 assistant 消息的问题。注释不会被应用自动拼入正文。
- **未完成生成**：区分正常完成、截断、过滤和拒绝等结果；已知异常结束时保留可复制的生成草稿，不自动覆盖正文或保存摘要。
- **草稿保存**：修复较早的保存或生成结果误清除后来草稿会话的问题；缺省的梗概字数在展示和请求中保持一致。
- **维护结构**：拆分书库、写作视图、上下文规划、会话协调、HTTP/Provider 与文件事务职责，扩充对应的失败和竞争回归测试。

本版本沿用现有书目文件格式，不需要手动迁移。升级前仍请导出重要书目的 JSON 备份，保留已有书库、模型配置和本地自定义文件。

下载的源码 ZIP 需要 Node.js **22.x（至少 22.18.0）或 24.x** 和 npm，安装步骤见[中文使用手册](USER_GUIDE.zh-CN.md#安装与打开)。`SHA256SUMS.txt` 用于核对源码包下载是否完整。真实 AI 续写仍需自行配置兼容服务、模型与密钥。

这仍是早期 Alpha：未提交文字不一定进入备份，保存冲突不会自动合并，模型兼容性仍取决于所选服务。完整变更见 [Alpha 1 → Alpha 2](https://github.com/beniedev/story-room/compare/v0.1.0-alpha.1...v0.1.0-alpha.2)。

### English

The second Alpha brings fixes for touch controls, model responses, and draft preservation, together with clearer internal module boundaries. The interface remains in Chinese.

- **Touch manuscript actions:** fix actions disappearing after a tap on phones and tablets, while preserving mouse hover, click, and pen interaction boundaries.
- **Section-note compatibility:** retain the note as assistant history, followed by a user request for prose. This fixes services rejecting a trailing assistant message. The app does not prepend the note to generated prose.
- **Incomplete generation:** distinguish normal completion, truncation, filtering, and refusal. Known abnormal endings retain a copyable draft instead of automatically replacing prose or saving a summary.
- **Draft saving:** prevent older save or generation results from clearing a newer draft session. Default summary lengths now agree between the displayed value and the request.
- **Maintainability:** separate bookshelf, writing views, context planning, session coordination, HTTP/Provider adapters, and file transactions, with expanded failure and race regression coverage.

The existing Book file format is retained; no manual migration is required. Before updating, export important Books as JSON backups and preserve your library, Provider configuration, and local customizations.

The source ZIP requires Node.js **22.x (at least 22.18.0) or 24.x** and npm. Follow the [User guide](USER_GUIDE.md#installation-and-access), and use `SHA256SUMS.txt` to verify the download. Real AI continuation still requires your own compatible service, model, and key.

This remains an early Alpha: unsubmitted text may not be in backups, save conflicts are not merged automatically, and model compatibility depends on the selected service. See the [Alpha 1 → Alpha 2 comparison](https://github.com/beniedev/story-room/compare/v0.1.0-alpha.1...v0.1.0-alpha.2) for the complete changes.

## 0.1.0-alpha.1

### 简体中文

故事书屋的首个 Alpha：把连续正文、角色和世界设定放在一起，在自己的电脑上写故事。当前界面为中文。

- 用作者模式推进情节，或以角色的第一人称参与故事；比较 AI 续写候选，选择采用的版本。
- 整理章节与小节，按需加载角色、世界设定和已确认的前文梗概，查看本轮选用材料与估算用量。
- 自动保存已完成的正文编辑与版本选择；导出 EPUB、Markdown、TXT 或 JSON，导入 JSON 可恢复为副本。

从源码安装，需要 Node.js 22.x（至少 22.18.0）或 24.x，以及 npm。把仓库链接交给能操作本机的 Agent，或按[使用手册](USER_GUIDE.zh-CN.md#安装与打开)安装。真实 AI 续写需要自行配置兼容 API 服务、模型与密钥；本项目不附带模型服务或订阅。

这是早期 Alpha，没有云端同步、多人协作或桌面安装包。模型请求会把本轮选用材料及书名、章节标题等定位信息发送给所选服务；密钥以明文保存在运行服务的电脑上。重要作品请保留独立备份：未发送或未确认的编辑框内容不一定进入 JSON，保存冲突也不会自动合并。较大的书目可能保存更慢。需要跨设备访问时仅使用受信任网络，不要直接开放到公网。

### English

The first Story Room Alpha brings continuous prose, characters, and worldbuilding together for writing on your own computer. The interface is currently in Chinese.

- Guide the story in author mode or take part in first person as a character. Compare AI continuations and choose the version to adopt.
- Organize chapters and sections, load selected character and world material and confirmed earlier-section summaries, and review the current context and estimated token use.
- Completed manuscript edits and version choices save automatically. Export EPUB, Markdown, TXT, or JSON; importing JSON restores a copy.

Install from source with Node.js 22.x (at least 22.18.0) or 24.x, and npm. Give the repository link to an agent that can work on your computer, or follow the [User guide](USER_GUIDE.md#installation-and-access). Real AI continuation requires your own compatible API service, model, and key. The project does not include a model service or subscription.

This early Alpha has no cloud sync, multi-user collaboration, or desktop installer. Model requests send selected material and location information such as Book and chapter titles to the chosen service. Keys are stored in plaintext on the computer running the app. Keep independent backups: unsent or unconfirmed editor text may not be in JSON, and save conflicts are not merged automatically. Larger Books may save more slowly. Use only a trusted network for access from other devices; do not expose the service directly to the public internet.

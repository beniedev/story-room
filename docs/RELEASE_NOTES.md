# 0.1.0-alpha.1 · 发布说明草稿 / Draft release notes

## 简体中文

故事书屋的首个 Alpha：把连续正文、角色和世界设定放在一起，在自己的电脑上写故事。当前界面为中文。

- 用作者模式推进情节，或以角色的第一人称参与故事；比较 AI 续写候选，选择采用的版本。
- 整理章节与小节，按需加载角色、世界设定和已确认的前文梗概，查看本轮选用材料与估算用量。
- 自动保存已完成的正文编辑与版本选择；导出 EPUB、Markdown、TXT 或 JSON，导入 JSON 可恢复为副本。

从源码安装，需要 Node.js 22.x（至少 22.18.0）或 24.x，以及 npm。把仓库链接交给能操作本机的 Agent，或按[使用手册](USER_GUIDE.zh-CN.md#安装与打开)安装。真实 AI 续写需要自行配置兼容 API 服务、模型与密钥；本项目不附带模型服务或订阅。

这是早期 Alpha，没有云端同步、多人协作或桌面安装包。模型请求会把本轮选用材料及书名、章节标题等定位信息发送给所选服务；密钥以明文保存在运行服务的电脑上。重要作品请保留独立备份：未发送或未确认的编辑框内容不一定进入 JSON，保存冲突也不会自动合并。较大的书目可能保存更慢。需要跨设备访问时仅使用受信任网络，不要直接开放到公网。

## English

The first Story Room Alpha brings continuous prose, characters, and worldbuilding together for writing on your own computer. The interface is currently in Chinese.

- Guide the story in author mode or take part in first person as a character. Compare AI continuations and choose the version to adopt.
- Organize chapters and sections, load selected character and world material and confirmed earlier-section summaries, and review the current context and estimated token use.
- Completed manuscript edits and version choices save automatically. Export EPUB, Markdown, TXT, or JSON; importing JSON restores a copy.

Install from source with Node.js 22.x (at least 22.18.0) or 24.x, and npm. Give the repository link to an agent that can work on your computer, or follow the [User guide](USER_GUIDE.md#installation-and-access). Real AI continuation requires your own compatible API service, model, and key. The project does not include a model service or subscription.

This early Alpha has no cloud sync, multi-user collaboration, or desktop installer. Model requests send selected material and location information such as Book and chapter titles to the chosen service. Keys are stored in plaintext on the computer running the app. Keep independent backups: unsent or unconfirmed editor text may not be in JSON, and save conflicts are not merged automatically. Larger Books may save more slowly. Use only a trusted network for access from other devices; do not expose the service directly to the public internet.

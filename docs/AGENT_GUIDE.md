# AI Agent 指南

这份指南给负责解释 Story Room、修复问题或维护仓库的 AI agent 使用。它把当前实现的入口和容易踩到的边界整理在一起，方便 agent 先给用户准确说明，再从正确的模块开始工作。

它是公开项目说明，不替代仓库根目录的 [`AGENTS.md`](../AGENTS.md)。`AGENTS.md` 里的安全、数据、协作和发布规则是硬规则；本指南只补充功能事实、代码地图和验证入口。代码和测试发生变化时，应以当前代码、测试和适用规则重新核对本页，不能把旧文档当作实现承诺。

## 给用户的功能解释

可以先用下面这段简短说明，再根据用户的问题展开：

> Story Room 是一个本地优先的连续小说写作空间。每本 Book 都把正文、章节、角色卡、世界观、剧情大纲和写作指导隔离在一起；你可以用作者模式续写，也可以选择角色用第一人称推进。AI 输出会作为正文候选版本保存，你可以比较并选择想保留的版本。运行在本机时，书稿写入可读文件，并可连接你信任的 OpenAI-compatible Provider；运行在浏览器 device 模式时，书稿留在当前浏览器的 localStorage，生成使用 Fake Provider。应用没有云端同步，重要内容应导出 JSON 备份。

回答具体问题时，先说明当前运行方式，再说明数据保存位置和实际按钮。不要把“可以测试 Provider”解释成 device 已支持真实生成，也不要把“预览上下文”解释成显示了隐藏推理。用户需要确认某个按钮是否存在时，回到当前组件查找真实中文标签。

解释生成流程时，至少交代三点：

1. “发送并续写”从当前小节继续；最后一块用户输入下的“生成回答”不会重复那段输入。
2. “再生成一版”会新增一个候选；“上一版”“下一版”只切换并保存当前候选，不会再次调用 AI。
3. 开启“流式输出”后，未完成的临时文字仍是草稿；取消或失败不会把它写入 Book。

解释资料和上下文时，说明“保存并加载”是明确确认动作：写作指导、剧情大纲、角色卡、世界观和前文梗概只有在确认后才进入后续生成。上下文概览展示纳入的资料和原因，不展示原始 Provider 消息或隐藏模型推理。

## 事实和行动边界

行为事实与行动授权是两件事，分别核对：

### 行为事实

遇到文档、实现和用户描述不一致时，先看当前运行代码、类型、路由和测试，尤其是用户所问功能直接调用到的模块。再用 [`docs/decisions/`](decisions/) 和 [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) 理解已作出的设计决定与信任边界；[`README.md`](../README.md) 与 [`USER_GUIDE.md`](USER_GUIDE.md) 主要提供用户措辞和操作顺序，仍需回到代码验证。`src/fixtures.ts` 和测试里的合成样例只能证明样例行为，不能当作用户真实数据或 Provider 能力证明。

“计划中”“未来 API”“兼容旧数据”都要以代码和对应文档的实际状态为准。发现文档过期时，先确认功能是否真的已接入调用链，再更新最接近的现有入口；不要为了让描述好看而承诺未实现的功能。

### 行动授权

是否可以修改、删除、上传、发布或操作外部系统，不由代码、README 或本页推定。以用户当前请求和 [`AGENTS.md`](../AGENTS.md) 为准；`AGENTS.md` 的安全、数据、协作和发布规则优先于本指南的便利建议。尤其是远端写入、push、release、deploy、license 和其他公开发布动作，只有在现有规则和 maintainer 授权都满足时才执行。

## 运行模型和不变量

### Book 是隔离边界

`Book` 是资料和正文的最小隔离单元。角色卡、世界观、剧情大纲、梗概、候选版本和 manuscript 文本只能来自当前 Book。切换书目、导入 JSON、生成上下文和导出时都要保持这个边界，不能以“方便上下文”之类的理由跨书读取或拼接。

### 两种写作模式共用一条管线

作者模式和角色模式共用保存、上下文计划、Provider 请求和应用生成结果的流程。角色模式只收窄本轮可用的角色视角和权限；不要为角色模式另造一套持久化或 prompt 发送路径。正文保持连续小说排版，用户输入和 AI 输出的块结构是编辑辅助数据，不是聊天气泡或消息时间线。

### 上下文是显式选择的

`contextPlan.ts` 计算本轮可能发送给 Provider 的资料和纳入原因。前文引用由用户确认；梗概必须是可用的新鲜 Memory，模型生成的草稿在确认前不能进入普通续写。上下文 token 估算用于预览和提示，不能冒充 Provider 的实际限制，也不应被实现成武断的应用级长度上限。

### Host 与 device

| 运行方式 | 保存和生成 | 维护时要记住 |
| --- | --- | --- |
| local-host | Book 写入可读文件；Fake 或配置的 OpenAI-compatible Provider | Provider key 与 Book 分开保存；保存请求按版本校验并串行处理 |
| hosted/device | Book 和恢复草稿在当前 origin 的浏览器存储；生成仍是 Fake | 存储未加密；同一 storage area 只能有一个编辑页，其他页只能读取已保存 Book |

device 的 Web Locks 只协调同一浏览器、同一 origin 的 storage area：

- 支持安全上下文（HTTPS 或可信本地页面）且锁可用时，一个标签页取得 writer lease。
- 其他标签页是 reader，可以阅读已保存书目、查看已保存上下文、调整显示设置和导出已保存内容，但不读取 writer 的 draft，也不能写 Book。
- reader 点“尝试成为编辑页”前应先关闭旧 writer；取得 lease 后会重新读取书库和当前 Book，再检查恢复草稿。
- 浏览器不支持 Web Locks、页面不是安全上下文或锁设置失败时，仍可读和导出，但 device 编辑保持关闭。
- 不同 origin、浏览器 profile、设备和独立 host 进程不由这把锁协调。

这些行为分别由 `deviceWriterLease.ts`、`deviceLibrary.ts` 和 `App.tsx` 串起来。新增 device 行为时，不要改成轮询、强制抢锁、共享 draft 或绕过 writer 检查；host 的 HTTP 保存路径也应保持原有边界。

## 代码小地图

| 入口 | 负责什么 | 修改时先看 |
| --- | --- | --- |
| [`src/App.tsx`](../src/App.tsx) | 运行时启动、书目选择、writer/reader 状态、自动保存、冲突、生成和组件回调 | 是否已经有同一动作的回调和保存管线；不要在组件里另写持久化 |
| [`src/types.ts`](../src/types.ts) | Book、Chapter、Section、块、候选、Context Reference、Section Memory、Provider Profile 的数据契约 | 新字段是否需要 normalize、导入校验、导出和两种运行时同时支持 |
| [`src/components/Bookshelf.tsx`](../src/components/Bookshelf.tsx) | 书架、章节/小节目录、本书设定、资料加载范围和名称对话框 | 当前中文标签、`canEdit` 只读门和确认对话框 |
| [`src/components/Writer.tsx`](../src/components/Writer.tsx) | 连续正文视图、作者/角色模式、块编辑、候选操作、生成输入和状态提示 | 生成按钮的目标块、只读页禁用状态和候选语义 |
| [`src/components/ContextToolsDrawer.tsx`](../src/components/ContextToolsDrawer.tsx) | “前文选择”、梗概草稿、生成梗概和“保存并加载梗概”确认 | 关闭不生效、确认才写 Book、只选当前小节之前的 Section |
| [`src/components/ContextCompositionDrawer.tsx`](../src/components/ContextCompositionDrawer.tsx) | “本轮上下文概览”，展示纳入资料、原因和估算 | 只展示摘要，不泄露原始 Provider messages 或隐藏推理 |
| [`src/components/ProviderSettings.tsx`](../src/components/ProviderSettings.tsx) 与 `App.tsx` 的设置区域 | Provider 表单、模型限制、测试、key 提示和流式开关 | host 与 device 的 key 生命周期和 `/models` 测试含义 |
| [`src/contextPlan.ts`](../src/contextPlan.ts)、`src/contextReferences.ts`、`src/sourceSelection.ts` | 资料选择、来源签名、摘要/全文引用、预算估算和 prompt packet | 只使用当前 Book；不要把 preview 当成原始 prompt 回显 |
| [`src/generationRequests.ts`](../src/generationRequests.ts) | 续写、回答和块再生成的目标范围 | regenerate 排除目标及后续内容；respond 不重复用户输入 |
| [`src/answerCandidates.ts`](../src/answerCandidates.ts) | 候选读取、采用、添加、删除和保存前后的保留语义 | `content` 是当前采用候选的投影；箭头切换不是生成 |
| [`src/sectionMemory.ts`](../src/sectionMemory.ts) | Section Memory 的结构、内容指纹、新鲜度、确认、上一快照和回滚 | model-draft 未确认不可用于普通续写；正文变化会使 Memory 过期 |
| [`src/bookImport.ts`](../src/bookImport.ts) 与 [`src/bookExport.ts`](../src/bookExport.ts) | JSON 校验/规范化、新 ID 导入、EPUB/Markdown/TXT/JSON 导出 | 导入建立副本且不覆盖现书；校验同一 Book 内的引用和候选关系 |
| [`src/api.ts`](../src/api.ts) | host/device API 形状、运行时分流、Provider 测试和生成响应 | device 生成保持 Fake；不要把临时 key 写入 story 或 localStorage |
| [`src/deviceLibrary.ts`](../src/deviceLibrary.ts) 与 [`src/deviceWriterLease.ts`](../src/deviceWriterLease.ts) | device 持久 Book、draft 边界、单 writer lease 和读者读取 | reader 只调用 persisted 读取，不调用会修复/播种的 writer 入口 |
| `server/domain.ts`、`server/store.ts`、`server/providers.ts`、`server/providerStream.ts` | local-host 的 Book 读写、版本冲突、Provider 调用和流式协议 | 全 Book 保存、串行保存队列、key 与 Book 分离、真实错误不能吞掉 |
| [`src/fixtures.ts`](../src/fixtures.ts) 与 `tests/` | 合成示例、兼容旧数据、功能契约和回归验证 | 只使用中性假数据；测试 double 不能被误当成生产能力 |

`src/styles.css` 负责外观和响应式布局。纯视觉修改仍应保留原生表单语义、键盘操作和 `canEdit` 状态；不要用 CSS 伪装成已禁用但仍可写的控件。

## 常见维护任务

### 改文案或一个控件

先在 `src/App.tsx` 和对应组件用 `rg` 搜索现有中文标签，再改最靠近实际渲染的位置。确认 aria label、title、状态提示和确认框描述没有互相矛盾。用户指南只记录真实标签，不要为方便说明臆造按钮路径。

### 增加或修改 Book 数据

从 `src/types.ts` 开始，随后检查：

1. `normalizeBook` 及相关领域 helper 是否能读取旧 Book。
2. `bookImport.ts` 是否校验和恢复该字段。
3. `bookExport.ts` 是否保留需要备份的内容。
4. `server/store.ts`、`deviceLibrary.ts` 和 App 的同一保存流程是否都能写回。
5. 当前书切换、冲突、候选和前文引用是否仍保持 Book 隔离。
6. 添加一个能证明真实行为的窄测试，再按规则运行完整验证。

不要在组件里直接 `localStorage.setItem` 或另造一条只保存半本 Book 的捷径。普通 Book 变化、资料确认、候选采用和前文引用都应沿用现有的完整保存管线。应用没有为了正文长度、候选数量或 Memory 项目数设置武断上限；Provider 的实际上下文和输出限制由配置的服务决定。

### 改上下文或生成

先阅读 `contextPlan.ts`、`generationRequests.ts` 和相关测试，确定请求的唯一目标、来源范围和候选 source signature。同步检查 `ContextCompositionDrawer` 的可见摘要：它必须与实际纳入原因大致一致，但不能显示原始 Provider messages 或隐藏推理。

变更资料加载时，要保持这些事实：剧情大纲是未来指导，当前小节注释只作用于相应请求，Section Memory 需要新鲜且已确认，用户没有确认的前文选择不能写入 Book。作者模式和角色模式都应经过同一 persistence/context/provider/apply pipeline。

### 改 Provider 或 API key

入口通常是 `src/providerProfiles.ts`、`src/api.ts`、`src/components/ProviderSettings.tsx` 和 `server/providers.ts`。先区分 host 与 device：

- host 可以保存 Fake 或 OpenAI-compatible profile；key 在独立 Provider 配置中按现有规则处理，不进入 Book、JSON、fixture、日志或错误文本。
- device 的 generation 仍是 Fake；连接测试可以临时把 key 发到填写的 `/models` URL，页面脚本在运行期间可读取，应用不持久化它。
- “测试成功”只表示 `/models` 可达，并在有列表时找到模型 ID；它不是 `/chat/completions` 参数兼容性证明。
- Provider 实际收到的材料由 context plan 决定；修改接口时不能绕过 Book 隔离或向 UI 回显原始内部消息。

### 改 Section Memory 或前文选择

从 `sectionMemory.ts` 的 draft、freshness、provenance 和 previous snapshot 语义开始，再看 `ContextToolsDrawer.tsx` 与 App 的生成/确认回调。生成的 model-draft 先停在页面编辑草稿，只有用户确认“保存并加载梗概”后才成为可用 Memory 和 context reference。正文改动后应按内容指纹重新判断新鲜度，而不是无条件沿用旧梗概。

### 改 device 单写者

先看 `deviceWriterLease.ts`、`deviceLibrary.ts`、App 的启动/接管/存储事件和 `tests/device-writer-lease.test.ts`、`tests/app-device-recovery.test.tsx`。维护时保留以下调用链：检查安全上下文和 Web Locks → 决定 writer/reader → writer 才读取 draft 或执行会改变 Book 的入口 → reader 只读持久 Book/导出 → 关闭旧 writer 后显式“尝试成为编辑页” → 新 writer 重读并再检查恢复草稿。

不要通过 host API、轮询、强制释放锁或额外依赖来“修好” device 并发。读者看到其他页面的 storage 更新时，应提示重新载入，不能静默替换正在阅读的内容。

## 用合成数据复现问题

复现和测试优先使用仓库已有的中性样例：`createExampleBooks()`、`createLegacyFixtureBook()`、Book export/import helper，以及 `tests/helpers/fakeDeviceLocks.ts`。自己写 fixture 时使用虚构的书名、角色、章节和内容；不要复制用户作品、真实姓名、账号、设备名、地址、端点或 key。

按当前问题选择相关场景即可，不必每次都覆盖整套流程。可选的最小场景包括：

- 生成、候选或正文问题：用 Fake Provider 建一本只有一章和两三个小节的 Book，覆盖问题涉及的作者/角色模式、空正文、最后一块用户输入、多个 AI 候选或取消生成。
- 资料和上下文问题：只使用当前 Book 的角色/世界观，检查确认前后 `contextReferences` 和可见上下文摘要的变化。
- 导入导出问题：用完整 JSON 的内存字符串，确认导入生成新 ID 且不覆盖原书。
- device 并发问题：使用 fake lock 和独立的 jsdom storage，验证问题涉及的 reader 持久读取、draft 隔离、writer 写入或接管重读。
- Provider 问题：使用假的响应或 Fake Provider；不要向真实端点发送 key。

这样得到的案例既能复现行为，也能安全放进公开测试和 issue。若问题只在真实 Provider 或特定浏览器发生，要记录抽象后的能力和错误形状，不要把凭据、完整请求、原始私密日志或用户书稿带进仓库。

## 验证入口

仓库规则要求在声称完成前运行：

```bash
npm test
npm run typecheck
npm run build
npm run build:local
```

需要快速缩小范围时，可以先运行相关测试，例如：

```bash
npx vitest run tests/book-import.test.ts tests/book-export.test.ts tests/context-reference.test.ts tests/section-memory.test.ts
npx vitest run tests/app-device-recovery.test.tsx tests/device-library.test.ts tests/device-writer-lease.test.ts
npx vitest run tests/writer-ui.test.tsx tests/context-ui.test.tsx tests/candidate-saving.test.tsx
```

涉及公开内容或依赖时，再运行：

```bash
npm run privacy:scan
npm run license:check
git diff --check
```

测试要说明验证的是哪条行为：静态类型和 build 证明能构建，测试证明合成数据下的契约，privacy scan 报告当前树中扫描到的已知私密模式；它们都不等于真实 Provider 调用、跨设备同步或自然使用周期已经验证。

## 对外发布和维护

文档、代码和测试可以在当前授权的仓库任务范围内维护；远端写入、push、release、deploy、license 或其他公开发布动作仍按 [`AGENTS.md`](../AGENTS.md) 交给 maintainer 授权。准备公开内容时，重新检查文件名、正文、fixture、错误文本、构建元数据和可达历史，使用通用项目术语和合成数据。

不要把本地绝对路径、私人部署名、真实书稿、Provider key、浏览器资料、内部工单或原始运行日志写入公开仓库。Provider 端点和设备存储都是信任边界；文档应如实写当前实现的风险和限制，不要用“本地”二字暗示已经加密、自动备份或多人协作。

如果用户要求的是新功能，先在代码和测试中找到最窄的实现入口，再决定需要更新哪些文档。若只有计划或设计，明确写成“未实现/计划中”；只有调用链、测试和用户界面都接好后，才把它写成当前功能。功能完成后优先同步 [`USER_GUIDE.md`](USER_GUIDE.md) 的操作步骤和本页的模块入口，避免制造第三套规则。

## 快速排查表

| 现象 | 先查哪里 | 正确的用户解释 |
| --- | --- | --- |
| device 页无法编辑 | `deviceWriterLease.ts`、App 的 `DeviceAccessBanner`、安全上下文和 Web Locks | 页面可能是只读；可以阅读/导出，关闭其他编辑页后点“尝试成为编辑页” |
| 修改后没有马上出现 | App 自动保存状态、`updatedAt`、保存队列和读者 storage event | 先看状态提示；冲突时导出 JSON，再显式重新载入，不自动合并 |
| AI 回答似乎重复用户输入 | `generationRequests.ts` 的 `respond-to-input` 路径和 Writer 的“生成回答” | 末尾用户块下的按钮会生成回答，不会复制那段输入 |
| 梗概改了但生成没变化 | `ContextToolsDrawer.tsx` 的确认流程、Section Memory freshness 和 `contextReferences` | 先确认“保存并加载梗概”；关闭前文抽屉而不确认不会生效 |
| Provider 测试成功但生成失败 | `/models` 测试语义、Provider 实现和实际 `/chat/completions` 响应 | 测试只证明模型发现/连通，不证明完整生成兼容 |
| 导入覆盖了原书的担忧 | `bookImport.ts` 和 App 的 import 回调 | JSON 导入建立恢复副本，原书目不覆盖 |

遇到未覆盖的行为，先保留证据和最小合成复现，再回到事实来源顺序；不要用猜测性的成功提示或文档措辞掩盖未知状态。

import type {
  Book,
  ContextPlan,
  GenerationMode,
  GenerationRequest,
  PromptBlock,
  PromptLayer,
  PromptSource,
} from '../src/types.ts';

export class RequestValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

const BASE_CONTRACT = [
  '你是小说写作助手。正文是唯一权威产物，不输出聊天标签、消息气泡说明或模型自述。',
  '只使用当前 Book 的材料。生成内容必须可以直接接入当前 Section 的连续小说正文。',
].join('\n');

const AUTHOR_POLICY = [
  '用户是本书作者，对全书拥有最高写作指令权。',
  '按照作者指令续写、改写或扩写，同时遵守本书已启用的资料。',
].join('\n');

const characterPolicy = (name: string) => [
  `用户正在扮演当前 Book 中的角色“${name}”。`,
  '使用第一人称连续小说正文。用户只控制所选角色的行动、台词、选择和明确表达的内心活动。',
  'AI 控制环境、事件后果、其他角色与叙述，但不得替用户决定所选角色的关键行动或承诺。',
].join('\n');

const estimateTokens = (content: string) => Math.ceil(Array.from(content).length / 3);

const block = (
  bookId: string,
  layer: PromptLayer,
  sourceId: string,
  title: string,
  content: string,
  reason: string,
  included: boolean,
  readOnly: boolean,
): PromptBlock => ({
  id: `${layer}:${sourceId}`,
  layer,
  title,
  content,
  bookId,
  sourceId,
  reason,
  included,
  readOnly,
  charCount: Array.from(content).length,
  estimatedTokens: estimateTokens(content),
});

const sourceBlock = (
  bookId: string,
  layer: PromptLayer,
  source: PromptSource,
  reason: string,
  forceInclude = false,
) => block(
  bookId,
  layer,
  source.id,
  source.title,
  source.content,
  forceInclude ? `${reason}（当前模式必需）` : reason,
  forceInclude || source.includeInPrompt,
  false,
);

const characterBlock = (
  bookId: string,
  character: Book['characters'][number],
  reason: string,
  forceInclude = false,
) => block(
  bookId,
  'character',
  character.id,
  character.name,
  [`角色名：${character.name}`, `角色身份：${character.role}`, character.content].join('\n'),
  forceInclude ? `${reason}（当前模式必需）` : reason,
  forceInclude || character.includeInPrompt,
  false,
);

export function buildContextPlan(book: Book, request: Omit<GenerationRequest, 'bookId'>): ContextPlan {
  const section = book.chapters.flatMap((chapter) => chapter.sections)
    .find((candidate) => candidate.id === request.sectionId);
  if (!section) throw new RequestValidationError('当前 Section 不属于这个 Book。');

  let selectedCharacter = undefined;
  if (request.mode === 'character') {
    selectedCharacter = book.characters.find((character) => character.id === request.selectedCharacterId);
    if (!selectedCharacter) throw new RequestValidationError('角色模式只能选择当前 Book 中的角色。');
  }

  const blocks: PromptBlock[] = [
    block(book.id, 'system', 'system:manuscript-contract', '正文合同', BASE_CONTRACT, '所有生成共享的正文与隔离底线', true, true),
    block(
      book.id,
      'mode',
      `mode:${request.mode}`,
      request.mode === 'author' ? '作者模式策略' : '角色模式策略',
      request.mode === 'author' ? AUTHOR_POLICY : characterPolicy(selectedCharacter!.name),
      request.mode === 'author' ? '用户以作者身份控制全书' : '收窄为所选角色的第一视角权限',
      true,
      true,
    ),
    block(book.id, 'book', book.id, '本书写作约定', book.writingBrief, '当前 Book 的可编辑长期写作约定', Boolean(book.writingBrief.trim()), false),
    ...book.characters.map((character) => characterBlock(
      book.id,
      character,
      request.mode === 'author' ? '作者模式启用的角色卡' : '角色模式的角色资料',
      request.mode === 'character' && character.id === selectedCharacter!.id,
    )),
    ...book.worldRules.map((source) => sourceBlock(book.id, 'world', source, '本书启用的世界观条例')),
    ...book.canonFacts.map((source) => sourceBlock(book.id, 'canon', source, '本书已确认的 Canon 事实')),
    ...book.summaries.map((source) => sourceBlock(book.id, 'summary', source, '本书启用的有来源摘要')),
    block(
      book.id,
      'manuscript',
      section.id,
      `当前正文 · ${section.title}`,
      section.content.slice(-4000),
      '为续写提供当前 Section 的末尾上下文',
      Boolean(section.content.trim()),
      true,
    ),
    block(book.id, 'instruction', 'request:instruction', '本轮指令', request.instruction, '本次生成的直接输入', Boolean(request.instruction.trim()), false),
  ];

  const included = blocks.filter((item) => item.included);
  const excluded = blocks.filter((item) => !item.included).map((item) => ({
    ...item,
    reason: item.content.trim() ? '已在本书 Prompt 管理中关闭' : '内容为空，未装入',
  }));
  const prompt = included.map((item) => `## ${item.title}\n${item.content}`).join('\n\n');

  return {
    bookId: book.id,
    mode: request.mode,
    selectedCharacterId: selectedCharacter?.id,
    included,
    excluded,
    prompt,
    estimatedTokens: included.reduce((total, item) => total + item.estimatedTokens, 0),
  };
}

export function fakeGenerate(book: Book, request: Omit<GenerationRequest, 'bookId'>): { plan: ContextPlan; draft: string } {
  const plan = buildContextPlan(book, request);
  const draft = request.mode === 'character'
    ? '我把手掌贴在冰凉的观测窗上。远处的星群缓慢转动，我知道，下一步必须由自己决定。身后的仪器发出短促的提示音，整座观测站像是在等待一个答案。'
    : '观测穹顶的灯光依次亮起，沉睡的仪器在寂静中恢复运转。远处的星群越过窗框，留下缓慢而清晰的轨迹；新的变化已经发生，但它的意义仍等待书中人物亲手确认。';
  return { plan, draft };
}

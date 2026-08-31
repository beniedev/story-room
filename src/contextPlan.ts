import type {
  Book,
  ContextPlan,
  GenerationRequest,
  PromptBlock,
  PromptCacheBand,
  PromptLayer,
  PromptSource,
} from './types';

export class ContextPlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextPlanInputError';
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
  cacheBand: PromptCacheBand,
  sourceId: string,
  title: string,
  content: string,
  reason: string,
  included: boolean,
  readOnly: boolean,
): PromptBlock => ({
  id: `${layer}:${sourceId}`,
  layer,
  cacheBand,
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
  'stable',
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
  'stable',
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
  if (!section) throw new ContextPlanInputError('当前 Section 不属于这个 Book。');

  let selectedCharacter = undefined;
  if (request.mode === 'character') {
    selectedCharacter = book.characters.find((character) => character.id === request.selectedCharacterId);
    if (!selectedCharacter) throw new ContextPlanInputError('角色模式只能选择当前 Book 中的角色。');
  }

  // Keep reusable material as one deterministic prefix. Content that changes per mode or turn
  // stays at the tail so providers with exact-prefix caching can reuse as much work as possible.
  const blocks: PromptBlock[] = [
    block(book.id, 'system', 'stable', 'system:manuscript-contract', '正文合同', BASE_CONTRACT, '所有生成共享的正文与隔离底线', true, true),
    block(book.id, 'book', 'stable', `${book.id}:identity`, '当前书目', `书名：${book.title}`, '锁定本次生成所属的 Book', true, true),
    block(book.id, 'book', 'stable', `${book.id}:style`, '写作风格指导', book.writingBrief, '当前 Book 的全局行文风格与语言表达', Boolean(book.writingBrief.trim()), false),
    ...book.worldRules.map((source) => sourceBlock(book.id, 'world', source, '本书启用的世界观条例')),
    ...book.characters.map((character) => characterBlock(
      book.id,
      character,
      request.mode === 'author' ? '作者模式启用的角色卡' : '角色模式的角色资料',
      request.mode === 'character' && character.id === selectedCharacter!.id,
    )),
    block(book.id, 'book', 'stable', `${book.id}:outline`, '剧情大纲', book.plotOutline ?? '', '当前 Book 的全局剧情指导', Boolean(book.plotOutline?.trim()), false),
    block(
      book.id,
      'mode',
      'session',
      `mode:${request.mode}`,
      request.mode === 'author' ? '作者模式策略' : '角色模式策略',
      request.mode === 'author' ? AUTHOR_POLICY : characterPolicy(selectedCharacter!.name),
      request.mode === 'author' ? '用户以作者身份控制全书' : '收窄为所选角色的第一视角权限',
      true,
      true,
    ),
    block(
      book.id,
      'note',
      'dynamic',
      `${section.id}:note`,
      '本节注释',
      section.note ?? '',
      '仅对当前 Section 生效的写作注释',
      Boolean(section.note?.trim()),
      false,
    ),
    block(
      book.id,
      'manuscript',
      'dynamic',
      section.id,
      `当前正文 · ${section.title}`,
      section.content.slice(-4000),
      '为续写提供当前 Section 的末尾上下文',
      Boolean(section.content.trim()),
      true,
    ),
    block(book.id, 'instruction', 'dynamic', 'request:instruction', '本轮指令', request.instruction, '本次生成的直接输入', Boolean(request.instruction.trim()), false),
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

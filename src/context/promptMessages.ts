import type { Book, ContextTarget, GenerationKind, GenerationRequest, PromptBlock, PromptMessage } from '../types.ts';

const targetReminders: Record<GenerationKind, { start: string; end: string }> = {
  'continue-section': {
    start: 'TARGET：只处理 JSON packet 中的唯一目标；只输出接在 TARGET SECTION 末尾的新小说正文。',
    end: 'TARGET：REFERENCE SECTION 已完成，不得重写/续写/总结；只输出接在 TARGET SECTION 末尾的新小说正文。',
  },
  'regenerate-block': {
    start: 'TARGET：只处理 JSON packet 中的唯一目标；从 TARGET 之前的当前正文重新作答，只输出一份新的回答。',
    end: 'TARGET：只输出新的回答；不得复述 TARGET 或读取其后的正文。',
  },
  'respond-to-input': {
    start: 'TARGET：只处理 JSON packet 中的唯一目标；回答 TARGET USER block，只输出一份新的回答。',
    end: 'TARGET：只输出 TARGET USER block 的回答；不得重复 TARGET USER 或读取其后的正文。',
  },
  'rewrite-selection': {
    start: 'TARGET：只处理 JSON packet 中的唯一目标；只输出选区替换正文。',
    end: 'TARGET：只输出选区替换正文，不输出其他 Section 内容。',
  },
  'summarize-section': {
    start: 'TARGET：只处理 JSON packet 中的唯一目标；只输出 SectionMemoryDraft schema JSON。',
    end: 'TARGET：只输出 schema JSON，不续写正文。',
  },
};

export const serializePromptPacket = (
  packet: unknown,
  generationKind: GenerationKind = 'continue-section',
) => {
  const reminder = targetReminders[generationKind];
  return `${reminder.start}\n${JSON.stringify(packet)}\n${reminder.end}`;
};

const packetFor = (
  book: Book,
  chapter: Book['chapters'][number],
  section: Book['chapters'][number]['sections'][number],
  target: ContextTarget,
  request: Omit<GenerationRequest, 'bookId'>,
  generationKind: GenerationKind,
  selectedCharacter: Book['characters'][number] | undefined,
  userBlocks: PromptBlock[],
) => ({
  version: 1,
  generationKind,
  target: {
    locator: {
      book: { title: book.title, index: 0 },
      chapter: { title: chapter.title, index: target.chapterIndex },
      section: { title: section.title, index: target.sectionIndex },
    },
  },
  mode: request.mode,
  ...(generationKind === 'summarize-section' ? {} : {
    selectedCharacterName: selectedCharacter?.name,
  }),
  blocks: userBlocks.map((item) => ({
    kind: item.semanticRole,
    title: item.title,
    content: item.content,
    ...(item.source?.chapterIndex !== undefined || item.source?.sectionIndex !== undefined ? {
      location: {
        ...(item.source.chapterIndex !== undefined ? { chapterIndex: item.source.chapterIndex } : {}),
        ...(item.source.sectionIndex !== undefined ? { sectionIndex: item.source.sectionIndex } : {}),
      },
    } : {}),
    ...(item.future ? { future: true } : {}),
  })),
});

export const messagesFor = (
  target: ContextTarget,
  request: Omit<GenerationRequest, 'bookId'>,
  generationKind: GenerationKind,
  selectedCharacter: Book['characters'][number] | undefined,
  included: PromptBlock[],
  chapter: Book['chapters'][number],
  section: Book['chapters'][number]['sections'][number],
  book: Book,
): PromptMessage[] => {
  const systemBlocks = included.filter((item) => item.messageRole === 'system');
  const userBlocks = included.filter((item) => item.messageRole === 'user');
  const assistantBlocks = included.filter((item) => item.messageRole === 'assistant');
  const messages: PromptMessage[] = [
    {
      role: 'system',
      content: systemBlocks.map((item) => item.content).join('\n\n'),
      blockIds: systemBlocks.map((item) => item.id),
    },
    {
      role: 'user',
      content: serializePromptPacket(
        packetFor(book, chapter, section, target, request, generationKind, selectedCharacter, userBlocks),
        generationKind,
      ),
      blockIds: userBlocks.map((item) => item.id),
    },
  ];
  if (assistantBlocks.length) {
    messages.push({
      role: 'assistant',
      content: assistantBlocks.map((item) => item.content).join('\n\n'),
      blockIds: assistantBlocks.map((item) => item.id),
    }, {
      role: 'user',
      content: '请按前述写作任务生成正文，不要复述小节注释。',
      blockIds: [],
    });
  }
  return messages;
};

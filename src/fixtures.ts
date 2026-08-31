import type { Book, CharacterCard, Chapter, SectionBlock } from './types';

interface CharacterSeed {
  name: string;
  role: string;
  content: string;
}

interface BookSeed {
  id: string;
  title: string;
  writingBrief: string;
  characters: CharacterSeed[];
  worldRule: { title: string; content: string };
  canon: { title: string; content: string };
  chapters: Array<{ title: string; sections: Array<{ title: string; content?: string; note?: string; blocks?: SectionBlock[] }> }>;
}

const observatoryOpeningBlocks: SectionBlock[] = [
  {
    id: 'the-observatory-block-1',
    kind: 'user',
    content: '让米拉在例行记录时发现异常，但先不要解释那束光是什么。',
  },
  {
    id: 'the-observatory-block-2',
    kind: 'assistant',
    content: '夜班开始后的第七码，米拉发现了那束光。\n\n它没有出现在任何预报里，却沿着观测窗的边缘稳定移动，像一行被刻意留下的句子。她关掉自动校准，玻璃上的微光仍然没有消失。',
  },
  {
    id: 'the-observatory-block-3',
    kind: 'user',
    content: '她先不报警，检查是不是玻璃、传感器或轨道尘埃造成的误差。',
  },
  {
    id: 'the-observatory-block-4',
    kind: 'assistant',
    content: '米拉把观测窗切换到遮光模式。室内的倒影一层层熄灭，最后只剩控制台上跳动的绿色刻度；那束光却穿过黑暗，仍旧停在她视线的正中央。\n\n她调出三组独立传感器。温度没有变化，辐射计没有读数，轨道尘埃模型也给出一条笔直的零线。\n\n“记录异常光源，等待人工复核。”她对值守系统说。\n\n零号沉默了两秒：“记录已存在。”',
  },
  {
    id: 'the-observatory-block-5',
    kind: 'user',
    content: '让她追问记录是什么时候建立的，同时让灯塔出现一个不可能实时抵达的回应。',
  },
  {
    id: 'the-observatory-block-6',
    kind: 'assistant',
    content: '米拉的手停在确认键上。\n\n“谁建立的记录？”\n\n屏幕展开一行时间戳：四小时后的零点十七分。按照延迟通讯条例，那是最近一次轨道窗口关闭之后的时间。\n\n她还没来得及复制数据，头顶的旧式扬声器忽然亮起。电流声像潮水一样漫过空舱，随后传出一个疲惫而清晰的声音：\n\n“米拉，别回答那束光。”\n\n声纹识别在下一秒给出结果——说话的人是她自己。',
  },
];

const blocksToContent = (blocks: SectionBlock[]) => blocks.map((block) => block.content).join('\n\n');
const previousObservatoryOpeningContent = '夜班开始后的第七码，米拉发现了那束光。\n\n它没有出现在任何预报里，却沿着观测窗的边缘稳定移动，像一行被刻意留下的句子。她关掉自动校准，玻璃上的微光仍然没有消失。';
const previousObservatoryOpeningBlocks: SectionBlock[] = [
  { id: 'the-observatory-block-1', kind: 'assistant', content: '玻璃上的微光仍然没有消失。' },
];

export const upgradeExampleBookContent = (current: Book, example: Book): Book | null => {
  if (current.id !== 'the-observatory' || example.id !== current.id) return null;
  const currentSection = current.chapters.flatMap((chapter) => chapter.sections)
    .find((section) => section.id === 'the-observatory-section-1-1');
  const nextSection = example.chapters.flatMap((chapter) => chapter.sections)
    .find((section) => section.id === currentSection?.id);
  if (!currentSection || !nextSection) return null;
  const hasKnownBlocks = currentSection.blocks === undefined
    || JSON.stringify(currentSection.blocks) === JSON.stringify(previousObservatoryOpeningBlocks);
  if (currentSection.content !== previousObservatoryOpeningContent || !hasKnownBlocks) return null;

  return {
    ...current,
    summaries: current.summaries.map((summary) => (
      summary.sourceSectionIds.includes(currentSection.id) && summary.content === previousObservatoryOpeningContent
        ? { ...summary, content: nextSection.content }
        : summary
    )),
    chapters: current.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.map((section) => section.id === currentSection.id
        ? { ...section, content: nextSection.content, blocks: nextSection.blocks }
        : section),
    })),
    updatedAt: example.updatedAt,
  };
};

const toCharacters = (bookId: string, seeds: CharacterSeed[]): CharacterCard[] => seeds.map((seed, index) => ({
  id: `${bookId}-character-${index + 1}`,
  name: seed.name,
  title: seed.name,
  role: seed.role,
  content: seed.content,
  includeInPrompt: true,
}));

const toChapters = (bookId: string, seeds: BookSeed['chapters']): Chapter[] => seeds.map((chapter, chapterIndex) => ({
  id: `${bookId}-chapter-${chapterIndex + 1}`,
  title: chapter.title,
  sections: chapter.sections.map((section, sectionIndex) => ({
    id: `${bookId}-section-${chapterIndex + 1}-${sectionIndex + 1}`,
    title: section.title,
    content: section.content ?? '',
    ...(section.note === undefined ? {} : { note: section.note }),
    ...(section.blocks === undefined ? {} : { blocks: section.blocks }),
  })),
}));

const createExampleBook = (seed: BookSeed): Book => {
  const chapters = toChapters(seed.id, seed.chapters);
  const firstSection = chapters[0]?.sections[0];
  return {
    id: seed.id,
    title: seed.title,
    writingBrief: seed.writingBrief,
    characters: toCharacters(seed.id, seed.characters),
    worldRules: [{
      id: `${seed.id}-world-1`,
      title: seed.worldRule.title,
      content: seed.worldRule.content,
      includeInPrompt: true,
    }],
    canonFacts: [{
      id: `${seed.id}-canon-1`,
      title: seed.canon.title,
      content: seed.canon.content,
      includeInPrompt: true,
    }],
    summaries: firstSection ? [{
      id: `${seed.id}-summary-1`,
      title: '开场摘要',
      content: firstSection.content || `${firstSection.title}尚未开始。`,
      includeInPrompt: true,
      sourceSectionIds: [firstSection.id],
    }] : [],
    chapters,
    branches: [],
    updatedAt: new Date().toISOString(),
  };
};

export const createExampleBooks = (): Book[] => [
  createExampleBook({
    id: 'the-observatory',
    title: '灯塔失语症',
    writingBrief: '冷静、清澈的近未来悬疑；通过空间、声音和人物选择推进，不用解释性旁白抢先揭谜。',
    characters: [
      { name: '米拉', role: '夜班观测员', content: '习惯先记录再行动，对没有证据的结论保持谨慎。' },
      { name: '伊恩', role: '灯塔维护师', content: '能从机械噪声中辨认故障，面对危险时会讲冷笑话。' },
      { name: '诺亚', role: '失联航船的领航员', content: '声音出现在延迟信号里，动机暂时不明。' },
      { name: '苏澄', role: '轨道气象研究员', content: '擅长发现重复规律，不轻易相信巧合。' },
      { name: '零号', role: '灯塔值守系统', content: '只回答被允许的问题，却会主动播放旧日录音。' },
    ],
    worldRule: { title: '延迟通讯条例', content: '跨轨道信号至少延迟四小时；任何即时回答都必须被视为异常。' },
    canon: { title: '灯塔仍在运行', content: '主能源稳定，外部通讯已经中断三天。' },
    chapters: [
      {
        title: '第一章 · 静默轨道',
        sections: [
          {
            title: '观测窗前',
            content: blocksToContent(observatoryOpeningBlocks),
            blocks: observatoryOpeningBlocks,
          },
          { title: '迟到四小时的问候' },
          { title: '无人签收的坐标' },
        ],
      },
      { title: '第二章 · 回声舱', sections: [{ title: '旧录音' }, { title: '维护井' }] },
      { title: '第三章 · 灯塔之外', sections: [{ title: '停泊许可' }, { title: '最后一次校准' }] },
    ],
  }),
  createExampleBook({
    id: 'harbor-at-noon',
    title: '月台尽头的邮局',
    writingBrief: '温柔但不甜腻的都市幻想；让超自然规则从日常细节里自然显形。',
    characters: [
      { name: '洛文', role: '临时代班邮差', content: '记路能力很差，却从不投错一封信。' },
      { name: '槿', role: '末班列车长', content: '只在雨天出现，坚持所有旅客都必须持有回程票。' },
      { name: '阿梨', role: '旧物店主人', content: '替人保管没有寄出的信，从不追问收件人。' },
      { name: '七号', role: '没有地址的常客', content: '每周来取同一封信，却声称第一次到访。' },
    ],
    worldRule: { title: '投递时间条例', content: '午夜后投入蓝色邮筒的信，会送达收件人最需要读到它的那一天。' },
    canon: { title: '废线仍有末班车', content: '停运十年的七号线会在连续降雨的第三晚短暂恢复。' },
    chapters: [
      {
        title: '第一章 · 雨夜代班',
        sections: [
          { title: '没有邮戳的信', content: '洛文接过信时，纸面还是温的。收件地址只有一句话：交给还没有决定离开的人。' },
          { title: '蓝色邮筒' },
        ],
      },
      { title: '第二章 · 末班列车', sections: [{ title: '回程票' }, { title: '停用月台' }, { title: '窗外的旧城区' }] },
      { title: '第三章 · 无法退回', sections: [{ title: '同一位收件人' }, { title: '天亮前投递' }] },
    ],
  }),
  createExampleBook({
    id: 'south-of-snowline',
    title: '雪线以南',
    writingBrief: '双主角公路小说；少用抒情判断，让关系通过选择、沉默和地貌变化呈现。',
    characters: [
      { name: '周遥', role: '地形测绘员', content: '做事按计划，随身记录每一次偏航。' },
      { name: '闻川', role: '山地向导', content: '熟悉旧路，对地图上不存在的村落避而不谈。' },
    ],
    worldRule: { title: '雪线移动规则', content: '每次暴雪后，雪线都会向南移动一公里，旧道路随之改变。' },
    canon: { title: '补给站已经关闭', content: '两人抵达前，最后一座补给站已封门七天。' },
    chapters: [
      {
        title: '第一章 · 偏离公路',
        sections: [
          { title: '错误的里程碑', content: '里程碑上的数字比地图多出十一公里。周遥停下车，闻川却让她不要回头看后视镜。' },
          { title: '封闭的补给站' },
        ],
      },
      { title: '第二章 · 南移一公里', sections: [{ title: '旧路标' }, { title: '没有名字的村落' }, { title: '雪停之后' }] },
    ],
  }),
];

export const createLegacyFixtureBook = (id: string, title: string, characterName: string): Book => ({
  id,
  title,
  writingBrief: '语言克制，保持空间感；新的事实必须与本书世界观和 Canon 一致。',
  characters: [{
    id: `${id}-observer`,
    name: characterName,
    title: characterName,
    role: '负责记录异常星象的年轻观测员',
    content: `${characterName}习惯先观察再行动，说话直接，对未经验证的结论保持谨慎。`,
    includeInPrompt: true,
  }],
  worldRules: [{ id: `${id}-signal-rule`, title: '远距信号条例', content: '跨星区信号需要数小时才能抵达，任何即时回信都应被视为异常。', includeInPrompt: true }],
  canonFacts: [{ id: `${id}-canon-station`, title: '观测站仍在运行', content: '观测站的主能源稳定，但外部通讯已经中断三天。', includeInPrompt: true }],
  summaries: [{ id: `${id}-summary-opening`, title: '开场摘要', content: `${characterName}在例行值班时发现一束不符合星图记录的脉冲。`, includeInPrompt: true, sourceSectionIds: [`${id}-section-opening`] }],
  chapters: [{ id: `${id}-chapter-one`, title: '第一章 · 静默轨道', sections: [{ id: `${id}-section-opening`, title: '观测窗前', content: `夜班开始后的第七码，${characterName}发现了那束光。\n\n它没有出现在任何预报里，却沿着观测窗的边缘稳定移动，像一行被刻意留下的句子。` }] }],
  branches: [],
  updatedAt: new Date().toISOString(),
});

import type { Book } from './types';

export const createFixtureBook = (id: string, title: string, characterName: string): Book => ({
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
  worldRules: [{
    id: `${id}-signal-rule`,
    title: '远距信号条例',
    content: '跨星区信号需要数小时才能抵达，任何即时回信都应被视为异常。',
    includeInPrompt: true,
  }],
  canonFacts: [{
    id: `${id}-canon-station`,
    title: '观测站仍在运行',
    content: '观测站的主能源稳定，但外部通讯已经中断三天。',
    includeInPrompt: true,
  }],
  summaries: [{
    id: `${id}-summary-opening`,
    title: '开场摘要',
    content: `${characterName}在例行值班时发现一束不符合星图记录的脉冲。`,
    includeInPrompt: true,
    sourceSectionIds: [`${id}-section-opening`],
  }],
  chapters: [{
    id: `${id}-chapter-one`,
    title: '第一章 · 静默轨道',
    sections: [{
      id: `${id}-section-opening`,
      title: '观测窗前',
      content: `夜班开始后的第七码，${characterName}发现了那束光。\n\n它没有出现在任何预报里，却沿着观测窗的边缘稳定移动，像一行被刻意留下的句子。`,
    }],
  }],
  branches: [],
  updatedAt: new Date().toISOString(),
});

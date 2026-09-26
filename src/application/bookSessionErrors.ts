import { BookConflictError } from '../api';

export const staleSaveError = () => new Error('保存期间正文已变化，请稍后重试。');
export const isBookConflictError = (error: unknown) => error instanceof BookConflictError
  || (error instanceof Error && (error.name === 'BookConflictError' || error.name === 'DeviceBookConflictError'))
  || (typeof error === 'object' && error !== null
    && ((error as { code?: unknown }).code === 'BOOK_CONFLICT'
      || (error as { statusCode?: unknown }).statusCode === 409));
export const bookConflictMessage = '这本书已在其他页面更新；当前本地内容仍保留，可导出 JSON 备份或重新载入当前书目。';
export const blockedBookConflictError = () => new BookConflictError();

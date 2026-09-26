export class StoreInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'StoreInputError';
  }
}

export class BookNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(bookId: string) {
    super(`找不到 Book：${bookId}`);
    this.name = 'BookNotFoundError';
  }
}

export class StoreConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = 'Book 已在其他页面更新，请重新载入后再保存。') {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreDataError extends Error {
  readonly statusCode = 500;

  constructor(message = '本地 Book 数据损坏。') {
    super(message);
    this.name = 'StoreDataError';
  }
}

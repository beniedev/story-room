export class ProviderInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderInputError';
  }
}

export class ProviderConnectionError extends Error {
  readonly statusCode: number = 502;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

/** The caller stopped waiting before the Provider finished. */
export class ProviderCancelledError extends ProviderConnectionError {
  readonly statusCode = 499;

  constructor() {
    super('生成已取消。');
    this.name = 'ProviderCancelledError';
  }
}

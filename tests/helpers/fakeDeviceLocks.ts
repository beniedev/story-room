type LockCallback<T> = (lock: Lock | null) => T | PromiseLike<T>;

export class FakeDeviceLockManager {
  readonly requests: Array<{ name: string; options: LockOptions }> = [];
  private readonly held = new Set<string>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private rejectNextRequest = false;

  rejectNext() {
    this.rejectNextRequest = true;
  }

  isHeld(name: string) {
    return this.held.has(name);
  }

  request<T>(name: string, options: LockOptions, callback: LockCallback<T>): Promise<T> {
    this.requests.push({ name, options });
    if (this.rejectNextRequest) {
      this.rejectNextRequest = false;
      return Promise.reject(new Error('synthetic Web Locks failure'));
    }
    if (options.ifAvailable && this.held.has(name)) {
      return Promise.resolve().then(() => callback(null));
    }
    const previous = this.tails.get(name) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(async () => {
      this.held.add(name);
      try { return await callback({ name } as Lock); }
      finally { this.held.delete(name); }
    });
    this.tails.set(name, result.catch(() => undefined));
    return result;
  }
}

export const installFakeDeviceLocks = () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const locks = new FakeDeviceLockManager();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks },
  });
  Object.defineProperty(globalThis, 'isSecureContext', {
    configurable: true,
    value: true,
  });

  return {
    locks,
    restore() {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete (globalThis as { navigator?: Navigator }).navigator;
      if (previousSecureContext) Object.defineProperty(globalThis, 'isSecureContext', previousSecureContext);
      else delete (globalThis as { isSecureContext?: boolean }).isSecureContext;
    },
  };
};

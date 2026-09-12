type LockCallback<T> = (lock: Lock | null) => T | PromiseLike<T>;

export class FakeDeviceLockManager {
  readonly requests: Array<{ name: string; options: LockOptions }> = [];
  private readonly held = new Set<string>();
  private rejectNextRequest = false;
  private abnormalNextGrant: 'resolve' | 'reject' | null = null;

  rejectNext() {
    this.rejectNextRequest = true;
  }

  resolveAfterNextGrant() {
    this.abnormalNextGrant = 'resolve';
  }

  rejectAfterNextGrant() {
    this.abnormalNextGrant = 'reject';
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
    this.held.add(name);
    const result = Promise.resolve().then(() => callback({ name } as Lock));
    const abnormal = this.abnormalNextGrant;
    this.abnormalNextGrant = null;
    if (abnormal) {
      void result.then(
        () => this.held.delete(name),
        () => this.held.delete(name),
      );
      return new Promise<T>((resolve, reject) => {
        queueMicrotask(() => {
          if (abnormal === 'resolve') resolve(undefined as T);
          else reject(new Error('synthetic Web Locks lifecycle failure'));
        });
      });
    }
    return result.finally(() => this.held.delete(name));
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

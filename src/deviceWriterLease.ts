export const DEVICE_WRITER_LOCK_NAME = 'story-native:device-library-writer:v1';

export type DeviceWriterState = {
  role: 'checking' | 'writer' | 'reader';
  reason?: 'occupied' | 'unsupported' | 'error';
};

export class DeviceWriterLeaseError extends Error {
  constructor(message = '当前页面不是设备书库编辑页，无法修改本地书库。') {
    super(message);
    this.name = 'DeviceWriterLeaseError';
  }
}

type ActiveLease = {
  token: symbol;
  release: () => void;
  released: boolean;
};

type Attempt = {
  generation: number;
  promise: Promise<DeviceWriterState>;
  resolve: (state: DeviceWriterState) => void;
  settled: boolean;
};

type PendingLockRequest = {
  token: symbol;
  promise: Promise<void>;
  releaseRequested: boolean;
};

let activeLease: ActiveLease | null = null;
const pendingLockRequests = new Set<PendingLockRequest>();

export const hasDeviceWriterLease = () => activeLease !== null;

export const assertDeviceWriterLease = () => {
  if (!hasDeviceWriterLease()) throw new DeviceWriterLeaseError();
};

const unsupportedState = (): DeviceWriterState => ({ role: 'reader', reason: 'unsupported' });
const errorState = (): DeviceWriterState => ({ role: 'reader', reason: 'error' });
const occupiedState = (): DeviceWriterState => ({ role: 'reader', reason: 'occupied' });

const getLockManager = (): { manager?: LockManager; reason?: 'unsupported' | 'error' } => {
  try {
    if (typeof navigator === 'undefined' || globalThis.isSecureContext !== true) {
      return { reason: 'unsupported' };
    }
    const manager = navigator.locks;
    if (typeof manager?.request !== 'function') return { reason: 'unsupported' };
    return { manager };
  } catch {
    return { reason: 'error' };
  }
};

export const createDeviceWriterLease = (onChange: (state: DeviceWriterState) => void) => {
  const token = Symbol('device-writer-lease');
  let disposed = false;
  let attemptGeneration = 0;
  let currentAttempt: Attempt | null = null;
  let currentLockRequest: PendingLockRequest | null = null;
  let state: DeviceWriterState = { role: 'checking' };

  const isCurrentAttempt = (generation: number) => !disposed && attemptGeneration === generation;

  const publish = (next: DeviceWriterState) => {
    if (disposed) return;
    state = next;
    onChange(next);
  };

  const finish = (attempt: Attempt, result: DeviceWriterState) => {
    if (attempt.settled) return;
    attempt.settled = true;
    if (currentAttempt?.generation === attempt.generation) currentAttempt = null;
    attempt.resolve(result);
  };

  const releaseLease = () => {
    currentLockRequest && (currentLockRequest.releaseRequested = true);
    if (activeLease?.token !== token) return;
    const lease = activeLease;
    activeLease = null;
    if (lease.released) return;
    lease.released = true;
    lease.release();
  };

  const attempt = (): Promise<DeviceWriterState> => {
    if (disposed) return Promise.resolve(errorState());
    if (activeLease?.token === token) return Promise.resolve(state.role === 'writer' ? state : { role: 'writer' });
    if (currentAttempt) return currentAttempt.promise;

    const generation = ++attemptGeneration;
    let resolveAttempt!: (result: DeviceWriterState) => void;
    const promise = new Promise<DeviceWriterState>((resolve) => {
      resolveAttempt = resolve;
    });
    const nextAttempt: Attempt = {
      generation,
      promise,
      resolve: resolveAttempt,
      settled: false,
    };
    currentAttempt = nextAttempt;

    try {
      publish({ role: 'checking' });
    } catch {
      const result = errorState();
      state = result;
      finish(nextAttempt, result);
      return promise;
    }

    const support = getLockManager();
    if (!support.manager) {
      const result = support.reason === 'error' ? errorState() : unsupportedState();
      publish(result);
      finish(nextAttempt, result);
      return promise;
    }

    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      resolveBarrier = resolve;
    });
    const pendingRequest: PendingLockRequest = {
      token,
      promise: barrier,
      releaseRequested: false,
    };
    currentLockRequest = pendingRequest;
    pendingLockRequests.add(pendingRequest);
    const releasedPriorRequests = [...pendingLockRequests]
      .filter((request) => request !== pendingRequest && request.releaseRequested)
      .map((request) => request.promise);

    const requestPromise = (async () => {
      await Promise.allSettled(releasedPriorRequests);
      if (!isCurrentAttempt(generation)) {
        finish(nextAttempt, errorState());
        return;
      }
      try {
        return await support.manager!.request(
          DEVICE_WRITER_LOCK_NAME,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!isCurrentAttempt(generation)) {
              finish(nextAttempt, errorState());
              return;
            }
            if (!lock) {
              const result = occupiedState();
              publish(result);
              finish(nextAttempt, result);
              return;
            }
            if (activeLease !== null) {
              const result = errorState();
              publish(result);
              finish(nextAttempt, result);
              return;
            }

            let resolveRelease!: () => void;
            let released = false;
            const lifecycle = new Promise<void>((resolve) => {
              resolveRelease = () => {
                released = true;
                resolve();
              };
            });
            activeLease = {
              token,
              release: resolveRelease,
              released: false,
            };
            try {
              publish({ role: 'writer' });
              finish(nextAttempt, { role: 'writer' });
            } catch (error) {
              releaseLease();
              throw error;
            }

            await lifecycle;
            if (!disposed && activeLease?.token === token && !released) {
              releaseLease();
              const result = errorState();
              publish(result);
              finish(nextAttempt, result);
            }
          },
        );
      } catch {
        throw new Error('Web Locks 请求失败。');
      }
    })();
    void requestPromise.then(
      () => {
        resolveBarrier();
        pendingLockRequests.delete(pendingRequest);
        if (currentLockRequest === pendingRequest) currentLockRequest = null;
        if (!isCurrentAttempt(generation)) return;
        if (activeLease?.token === token) {
          releaseLease();
          publish(errorState());
        }
        finish(nextAttempt, errorState());
      },
      () => {
        resolveBarrier();
        pendingLockRequests.delete(pendingRequest);
        if (currentLockRequest === pendingRequest) currentLockRequest = null;
        if (!isCurrentAttempt(generation)) return;
        releaseLease();
        const result = errorState();
        publish(result);
        finish(nextAttempt, result);
      },
    );

    return promise;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    attemptGeneration += 1;
    if (currentLockRequest) currentLockRequest.releaseRequested = true;
    const pending = currentAttempt;
    currentAttempt = null;
    if (pending) {
      pending.settled = true;
      pending.resolve(errorState());
    }
    releaseLease();
  };

  return { attempt, dispose };
};

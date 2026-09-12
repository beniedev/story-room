import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEVICE_WRITER_LOCK_NAME,
  assertDeviceWriterLease,
  createDeviceWriterLease,
  hasDeviceWriterLease,
} from '../src/deviceWriterLease';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

describe('device writer lease', () => {
  let environment: ReturnType<typeof installFakeDeviceLocks>;
  const leases: Array<ReturnType<typeof createDeviceWriterLease>> = [];

  beforeEach(() => {
    environment = installFakeDeviceLocks();
  });

  afterEach(() => {
    leases.splice(0).forEach((lease) => lease.dispose());
    environment.restore();
  });

  const createLease = (onChange: Parameters<typeof createDeviceWriterLease>[0] = () => undefined) => {
    const lease = createDeviceWriterLease(onChange);
    leases.push(lease);
    return lease;
  };

  it('does not request a lock until attempt and holds writer access until dispose', async () => {
    const changes: string[] = [];
    const lease = createLease((next) => changes.push(next.role));

    expect(environment.locks.requests).toHaveLength(0);
    expect(hasDeviceWriterLease()).toBe(false);

    await expect(lease.attempt()).resolves.toEqual({ role: 'writer' });
    expect(changes).toEqual(['checking', 'writer']);
    expect(environment.locks.requests).toEqual([{
      name: DEVICE_WRITER_LOCK_NAME,
      options: { mode: 'exclusive', ifAvailable: true },
    }]);
    expect(environment.locks.isHeld(DEVICE_WRITER_LOCK_NAME)).toBe(true);
    expect(hasDeviceWriterLease()).toBe(true);
    expect(() => assertDeviceWriterLease()).not.toThrow();

    lease.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(environment.locks.isHeld(DEVICE_WRITER_LOCK_NAME)).toBe(false);
    expect(hasDeviceWriterLease()).toBe(false);
  });

  it('lets only one page become writer and supports explicit takeover after release', async () => {
    const first = createLease();
    const second = createLease();

    await expect(first.attempt()).resolves.toEqual({ role: 'writer' });
    await expect(second.attempt()).resolves.toEqual({ role: 'reader', reason: 'occupied' });
    expect(hasDeviceWriterLease()).toBe(true);

    first.dispose();
    await Promise.resolve();
    await expect(second.attempt()).resolves.toEqual({ role: 'writer' });
    expect(hasDeviceWriterLease()).toBe(true);
  });

  it('does not let a disposed lease callback revoke a newer token', async () => {
    const oldLease = createLease();
    await expect(oldLease.attempt()).resolves.toEqual({ role: 'writer' });
    oldLease.dispose();
    await Promise.resolve();

    const newLease = createLease();
    await expect(newLease.attempt()).resolves.toEqual({ role: 'writer' });
    oldLease.dispose();

    expect(hasDeviceWriterLease()).toBe(true);
    expect(() => assertDeviceWriterLease()).not.toThrow();
  });

  it('waits for a disposed StrictMode setup to release before starting the next setup', async () => {
    const oldLease = createLease();
    const oldAttempt = oldLease.attempt();
    oldLease.dispose();

    const newLease = createLease();
    await expect(oldAttempt).resolves.toEqual({ role: 'reader', reason: 'error' });
    await expect(newLease.attempt()).resolves.toEqual({ role: 'writer' });
    expect(hasDeviceWriterLease()).toBe(true);
  });

  it('fails closed when secure Web Locks are unavailable or request rejects', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    const unsupported = createLease();
    await expect(unsupported.attempt()).resolves.toEqual({ role: 'reader', reason: 'unsupported' });
    expect(environment.locks.requests).toHaveLength(0);
    expect(hasDeviceWriterLease()).toBe(false);

    environment.restore();
    environment = installFakeDeviceLocks();
    environment.locks.rejectNext();
    const failed = createLease();
    await expect(failed.attempt()).resolves.toEqual({ role: 'reader', reason: 'error' });
    expect(hasDeviceWriterLease()).toBe(false);
  });

  it('turns a throwing Web Locks getter into a settled error reader state', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get() {
        throw new Error('synthetic SecurityError');
      },
    });
    const lease = createLease();

    await expect(lease.attempt()).resolves.toEqual({ role: 'reader', reason: 'error' });
    expect(hasDeviceWriterLease()).toBe(false);
  });

  it('revokes writer access when the lock request rejects after granting the lock', async () => {
    environment.locks.rejectAfterNextGrant();
    const changes: string[] = [];
    const lease = createLease((next) => changes.push(next.role));

    await expect(lease.attempt()).resolves.toEqual({ role: 'writer' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(hasDeviceWriterLease()).toBe(false);
    expect(changes).toEqual(['checking', 'writer', 'reader']);
    expect(() => assertDeviceWriterLease()).toThrow('不是设备书库编辑页');
  });

  it('revokes writer access when the lock callback ends before page disposal', async () => {
    environment.locks.resolveAfterNextGrant();
    const lease = createLease();

    await expect(lease.attempt()).resolves.toEqual({ role: 'writer' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(hasDeviceWriterLease()).toBe(false);
    expect(() => assertDeviceWriterLease()).toThrow('不是设备书库编辑页');
  });
});

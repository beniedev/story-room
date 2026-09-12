import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_WRITER_LOCK_NAME, withDeviceLibraryWrite } from '../src/deviceWriterLease';
import { installFakeDeviceLocks } from './helpers/fakeDeviceLocks';

let environment: ReturnType<typeof installFakeDeviceLocks>;
beforeEach(() => { environment = installFakeDeviceLocks(); });
afterEach(() => environment.restore());

describe('device write coordination', () => {
  it('automatically queues writes and releases the lock after each operation', async () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((r) => { started = r; });
    const held = environment.locks.request(DEVICE_WRITER_LOCK_NAME, {}, () => new Promise<void>((r) => { release = r; started(); }));
    await ready;
    const calls: number[] = [];
    const first = withDeviceLibraryWrite(() => { calls.push(1); return 'one'; });
    const second = withDeviceLibraryWrite(() => { calls.push(2); return 'two'; });
    expect(calls).toEqual([]);
    release();
    await held;
    expect(await Promise.all([first, second])).toEqual(['one', 'two']);
    expect(calls).toEqual([1, 2]);
    expect(environment.locks.isHeld(DEVICE_WRITER_LOCK_NAME)).toBe(false);
    expect(environment.locks.requests.slice(1).every(({ options }) => !options.ifAvailable && !options.steal)).toBe(true);
  });

  it('releases after an operation fails, and never replays a failed write', async () => {
    let calls = 0;
    await expect(withDeviceLibraryWrite(() => { calls += 1; throw new Error('synthetic write failure'); })).rejects.toThrow('synthetic write failure');
    expect(calls).toBe(1);
    expect(await withDeviceLibraryWrite(() => 'next')).toBe('next');
    environment.locks.rejectNext();
    await expect(withDeviceLibraryWrite(() => { calls += 1; })).rejects.toThrow('Web Locks failure');
    expect(calls).toBe(1);
  });
});

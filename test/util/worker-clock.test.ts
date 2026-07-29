import { expect, test } from 'bun:test';

import { installWorkerClockHub, WorkerClock } from '#/util/WorkerClock.js';

test('sleep falls back to setTimeout and resolves after ~ms when Worker is unavailable', async () => {
    const saved = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = undefined;
    try {
        const start = performance.now();
        await WorkerClock.sleep(20);
        expect(performance.now() - start).toBeGreaterThanOrEqual(15);
    } finally {
        (globalThis as { Worker?: unknown }).Worker = saved;
    }
});

test('sleep(0) resolves promptly', async () => {
    await expect(WorkerClock.sleep(0)).resolves.toBeUndefined();
});

test('a wall installs one reusable parent clock', async () => {
    let posted = 0;
    class FakeWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: (() => void) | null = null;

        postMessage(message: { id: number }): void {
            posted++;
            queueMicrotask(() => this.onmessage?.({ data: [message.id] } as MessageEvent));
        }

        terminate(): void {}
    }
    class FakeBlob {
        constructor(..._args: unknown[]) {}
    }
    const owner = {
        Worker: FakeWorker as unknown as typeof Worker,
        Blob: FakeBlob as unknown as typeof Blob,
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as unknown as typeof URL,
        setTimeout
    };

    const first = installWorkerClockHub(owner);
    expect(installWorkerClockHub(owner)).toBe(first);
    await first.sleep(20);
    expect(posted).toBe(1);
});

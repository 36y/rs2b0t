import { describe, expect, test } from 'bun:test';

import { FreezeWatch } from '#/bot/runtime/diag/FreezeWatch.js';

/** Drives the watch off a scripted clock so a "freeze" is exact, not timing-dependent. */
function scripted(overshoots: number[]) {
    let clock = 0;
    let call = 0;
    const probeMs = 250;
    const watch = new FreezeWatch({
        probeMs,
        thresholdMs: 250,
        sleep: async (ms: number): Promise<void> => {
            clock += ms + (overshoots[call++] ?? 0);
        },
        now: () => clock,
        wallClock: () => 1_000_000 + clock
    });
    return { watch, probes: overshoots.length };
}

describe('FreezeWatch', () => {
    test('measures a stall as overshoot past the requested delay', () => {
        const { watch } = scripted([]);
        watch.record(0);
        watch.record(3000);
        watch.record(0);

        const snap = watch.snapshot();
        expect(snap.events).toHaveLength(1);
        // the reported figure is the stall itself, not the probe interval
        expect(snap.events[0].stallMs).toBe(3000);
        expect(snap.worstMs).toBe(3000);
        expect(snap.probes).toBe(3);
    });

    test('sub-threshold jitter is counted but not recorded as a freeze', () => {
        const { watch } = scripted([]);
        watch.record(10);
        watch.record(20);

        const snap = watch.snapshot();
        expect(snap.events).toHaveLength(0);
        expect(snap.worstMs).toBe(20);
        expect(snap.stallTotalMs).toBe(30);
    });

    test('keeps the earliest evidence and counts what it refused to store', () => {
        let clock = 0;
        const watch = new FreezeWatch({
            capacity: 2,
            thresholdMs: 100,
            sleep: async (): Promise<void> => undefined,
            now: () => clock++,
            wallClock: () => clock
        });
        watch.record(500);
        watch.record(600);
        watch.record(700);

        const snap = watch.snapshot();
        expect(snap.events.map(e => e.stallMs)).toEqual([500, 600]);
        expect(snap.dropped).toBe(1);
    });

    test('drainStallMs yields per-sample stall and resets', () => {
        const { watch } = scripted([]);
        watch.record(40);
        watch.record(60);
        expect(watch.drainStallMs()).toBe(100);
        expect(watch.drainStallMs()).toBe(0);
    });

    test('the probe loop measures real overshoot end to end', async () => {
        let clock = 0;
        const overshoots = [0, 1200, 0];
        let call = 0;
        const watch = new FreezeWatch({
            probeMs: 250,
            thresholdMs: 250,
            sleep: async (ms: number): Promise<void> => {
                clock += ms + (overshoots[call] ?? 0);
                call++;
                if (call >= overshoots.length) {
                    watch.stop();
                }
            },
            now: () => clock,
            wallClock: () => clock
        });

        await watch.run();

        const snap = watch.snapshot();
        expect(snap.probes).toBe(overshoots.length);
        expect(snap.events).toHaveLength(1);
        expect(snap.events[0].stallMs).toBe(1200);
    });

    test('rejects malformed configuration loudly', () => {
        const sleep = async (): Promise<void> => undefined;
        expect(() => new FreezeWatch({ sleep, probeMs: 0 })).toThrow(/probe interval must be positive/);
        expect(() => new FreezeWatch({ sleep, thresholdMs: -1 })).toThrow(/threshold must be non-negative/);
    });
});

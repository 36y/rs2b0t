import { describe, expect, test } from 'bun:test';

import { InputLatency, browserObserverFactory } from '#/bot/runtime/diag/InputLatency.js';

function fake() {
    let emit: (entries: { duration: number; name: string }[]) => void = () => undefined;
    let observed: { type: string; durationThreshold?: number } | null = null;
    const latency = new InputLatency(onEntries => {
        emit = onEntries;
        return {
            observe: (options): void => {
                observed = options;
            },
            disconnect: (): void => undefined
        };
    }, 100);
    return { latency, fire: (...e: { duration: number; name: string }[]): void => emit(e), observed: () => observed };
}

describe('InputLatency', () => {
    test('reports the worst input as its real duration', () => {
        const f = fake();
        f.latency.start();
        f.fire({ duration: 2000, name: 'contextmenu' }, { duration: 120, name: 'pointerdown' });

        const reading = f.latency.drain();
        expect(reading.maxMs).toBe(2000);
        expect(reading.count).toBe(2);
        expect(f.latency.worstEvent).toBe('contextmenu');
    });

    test('drain resets so each sample window stands alone', () => {
        const f = fake();
        f.latency.start();
        f.fire({ duration: 500, name: 'click' });
        f.latency.drain();

        expect(f.latency.drain()).toEqual({ maxMs: 0, count: 0 });
    });

    test('observes event timing above the reporting threshold', () => {
        const f = fake();
        f.latency.start();
        expect(f.observed()?.type).toBe('event');
        expect(f.observed()?.durationThreshold).toBe(100);
    });

    test('double start throws rather than double-counting every event', () => {
        const f = fake();
        f.latency.start();
        expect(() => f.latency.start()).toThrow(/already started/);
    });

    test('a browser without Event Timing fails loudly instead of reporting zero lag', () => {
        const noSupport = { PerformanceObserver: Object.assign(function () {}, { supportedEntryTypes: ['mark'] }) };
        expect(() => browserObserverFactory(noSupport as unknown as typeof globalThis)).toThrow(/no Event Timing/);

        expect(() => browserObserverFactory({} as unknown as typeof globalThis)).toThrow(/no Event Timing/);
    });
});

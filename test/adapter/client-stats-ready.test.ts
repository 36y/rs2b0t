import { expect, test } from 'bun:test';
import { activeStatsReady, currentLoginStatsReady } from '#/bot/adapter/ClientAdapter.js';

test('activeStatsReady rejects the empty snapshot seen during login', () => {
    const levels = new Int32Array(25);
    expect(activeStatsReady(levels)).toBe(false);

    levels.fill(1);
    expect(activeStatsReady(levels)).toBe(true);
});

test('activeStatsReady ignores unused slots but requires every active skill', () => {
    const levels = new Int32Array(25);
    levels.fill(1);
    levels[19] = 0;
    levels[21] = 0;
    expect(activeStatsReady(levels)).toBe(true);

    levels[20] = 0;
    expect(activeStatsReady(levels)).toBe(false);
});

test('currentLoginStatsReady rejects stale positive stats on a second login', () => {
    const levels = new Int32Array(25);
    const seenGenerations = new Int32Array(25);

    levels.fill(50);
    seenGenerations.fill(1);
    expect(currentLoginStatsReady(levels, seenGenerations, 1)).toBe(true);

    // Login two retains the positive level array, but its Runecraft packet has
    // not arrived. Generation one must not satisfy generation two readiness.
    seenGenerations.fill(2);
    seenGenerations[20] = 1;
    expect(currentLoginStatsReady(levels, seenGenerations, 2)).toBe(false);

    seenGenerations[20] = 2;
    expect(currentLoginStatsReady(levels, seenGenerations, 2)).toBe(true);
});

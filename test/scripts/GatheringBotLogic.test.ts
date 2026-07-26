import { describe, expect, test } from 'bun:test';
import { shouldYieldGathering } from '#/bot/scripts/GatheringBot.js';

describe('shouldYieldGathering', () => {
    test('a pending random event interrupts an active gather loop', () => {
        expect(shouldYieldGathering(true, false, false, false)).toBe(true);
    });

    test('an uninterrupted gather loop keeps waiting', () => {
        expect(shouldYieldGathering(false, false, false, false)).toBe(false);
    });

    test('existing full-pack, dialog, and missing-target exits remain intact', () => {
        expect(shouldYieldGathering(false, true, false, false)).toBe(true);
        expect(shouldYieldGathering(false, false, true, false)).toBe(true);
        expect(shouldYieldGathering(false, false, false, true)).toBe(true);
    });
});

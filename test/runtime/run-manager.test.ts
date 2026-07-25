import { expect, test, describe } from 'bun:test';

import { shouldEnableRun } from '#/bot/runtime/RunManager.js';

describe('shouldEnableRun', () => {
    test('never re-toggles run that is already on', () => {
        expect(shouldEnableRun({ runOn: true, inCombat: false, energy: 100, energyMin: 20 })).toBe(false);
        expect(shouldEnableRun({ runOn: true, inCombat: true, energy: 100, energyMin: 20 })).toBe(false);
    });

    test('out of combat it waits for the regen floor', () => {
        expect(shouldEnableRun({ runOn: false, inCombat: false, energy: 19, energyMin: 20 })).toBe(false);
        expect(shouldEnableRun({ runOn: false, inCombat: false, energy: 20, energyMin: 20 })).toBe(true);
    });

    test('under attack it runs on whatever energy is left', () => {
        expect(shouldEnableRun({ runOn: false, inCombat: true, energy: 1, energyMin: 20 })).toBe(true);
        expect(shouldEnableRun({ runOn: false, inCombat: true, energy: 19, energyMin: 20 })).toBe(true);
    });

    test('under attack with no energy there is nothing to toggle', () => {
        expect(shouldEnableRun({ runOn: false, inCombat: true, energy: 0, energyMin: 20 })).toBe(false);
    });
});

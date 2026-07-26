import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import { SETTINGS } from '#/bot/scripts/AutoFighter.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    CUSTOM_COORDINATES,
    DEFAULT_LOOT,
    resolveKillingSpot,
    SPOT_OPTIONS,
    START_POSITION
} from '#/bot/scripts/AutoFighterData.js';
import { resolveControl } from '#/bot/ui/paramControls.js';

describe('AutoFighter data', () => {
    test('loot defaults to exactly gems + clues (the spec set)', () => {
        expect(DEFAULT_LOOT).toEqual([
            'clue scroll',
            'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
            'half of a key',
            'chaos talisman', 'nature talisman'
        ]);
    });
    test('target is a freeform text control', () => {
        expect(SETTINGS.target.options).toBeUndefined();
        expect(resolveControl(SETTINGS.target)).toBe('text');
    });
    test('killing spot defaults to the script start or accepts coordinates', () => {
        expect(SPOT_OPTIONS).toEqual([START_POSITION, CUSTOM_COORDINATES]);
        expect(SETTINGS.spot.default).toBe(START_POSITION);
        expect(SETTINGS.coordinates.showIf).toEqual({ key: 'spot', anyOf: [CUSTOM_COORDINATES] });

        const start = new Tile(3200, 3201, 0);
        const custom = new Tile(3300, 3301, 1);
        expect(resolveKillingSpot(START_POSITION, start, custom).equals(start)).toBe(true);
        expect(resolveKillingSpot(CUSTOM_COORDINATES, start, custom).equals(custom)).toBe(true);
        expect(resolveKillingSpot('unknown legacy preset', start, custom).equals(start)).toBe(true);
    });
    test('banking uses the Miner-style Auto or None choice', () => {
        expect(BANKING_OPTIONS).toEqual(['Auto', 'None']);
        expect(SETTINGS.banking.options).toEqual(BANKING_OPTIONS);
        expect(autoBankEnabled('Auto')).toBe(true);
        expect(autoBankEnabled('auto')).toBe(true);
        expect(autoBankEnabled('None')).toBe(false);
    });
});

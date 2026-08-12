import { describe, expect, test } from 'bun:test';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { SLOTS } from '#/bot/api/loadout/types.js';

describe('ITEM_DB', () => {
    test('carries the whole equippable catalog', () => {
        expect(ITEM_DB.filter(r => r.slot).length).toBeGreaterThan(600);
    });

    test('every slot is a known slot', () => {
        const known = new Set<string>(SLOTS);
        for (const r of ITEM_DB) {
            if (r.slot) {
                expect(known.has(r.slot)).toBe(true);
            }
        }
    });

    test('every record is either wearable or consumable', () => {
        expect(ITEM_DB.every(r => r.slot !== undefined || r.consumable !== undefined)).toBe(true);
    });

    test('ids are unique', () => {
        expect(new Set(ITEM_DB.map(r => r.id)).size).toBe(ITEM_DB.length);
    });

    test('the rune scimitar is a one-handed righthand weapon', () => {
        const scim = ITEM_DB.find(r => r.name === 'Rune scimitar');
        expect(scim?.slot).toBe('righthand');
        expect(scim?.twoHanded).toBeUndefined();
    });

    test('lobster is an edible with no slot', () => {
        const lobster = ITEM_DB.find(r => r.name === 'Lobster');
        expect(lobster?.consumable).toBe('eat');
        expect(lobster?.slot).toBeUndefined();
    });
});

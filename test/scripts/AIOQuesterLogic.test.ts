import { describe, expect, test } from 'bun:test';
import { resolveConsumeAction, resolveSustainPolicy } from '#/bot/scripts/AIOQuesterLogic.js';

describe('resolveConsumeAction', () => {
    test('uses the exact offered Eat or Drink operation', () => {
        expect(resolveConsumeAction(['Use', 'Eat', 'Drop'])).toBe('Eat');
        expect(resolveConsumeAction(['drink', 'Drop'])).toBe('drink');
    });

    test('fails closed when the item is not consumable', () => {
        expect(resolveConsumeAction(['Use', 'Drop'])).toBeNull();
    });
});

describe('resolveSustainPolicy', () => {
    test('uses the configured food when no quest policy is active', () => {
        expect(resolveSustainPolicy('Trout')).toEqual({
            foods: ['trout']
        });
    });

    test('adds active quest foods ahead of the configured food', () => {
        expect(resolveSustainPolicy('Trout', {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread', 'trout']
        });
    });

    test('trims, ignores empty names, and de-duplicates foods case-insensitively', () => {
        expect(resolveSustainPolicy(' BREAD ', {
            foods: ['Bread', '', ' bread ', 'Tuna'],
            eatBelowHp: 0.75
        })).toEqual({
            foods: ['bread', 'tuna']
        });
    });

    test('allows quest food when the configured food is blank', () => {
        expect(resolveSustainPolicy(null, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread']
        });
    });

    test('keeps eating a cake once it has been bitten', () => {
        expect(resolveSustainPolicy('Cake').foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('covers the half-eaten form of every multi-bite food it is given', () => {
        expect(resolveSustainPolicy('Meat pie').foods).toEqual(['meat pie', 'half a meat pie']);
        expect(resolveSustainPolicy('Chocolate cake').foods)
            .toEqual(['chocolate cake', '2/3 chocolate cake', 'chocolate slice']);
    });

    test('de-duplicates when a quest food and the configured food share a chain', () => {
        expect(resolveSustainPolicy('Cake', {
            foods: ['Cake'],
            eatBelowHp: 0.5
        }).foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('leaves single-stage food alone', () => {
        expect(resolveSustainPolicy(' Shark ').foods).toEqual(['shark']);
    });
});

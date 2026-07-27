import { describe, expect, test } from 'bun:test';
import { autoFoodBanking, countFood, foodMatches, safeToSteal, shouldRestockFood, THIEVER_BANKING_OPTIONS } from '#/bot/scripts/ThievingBotLogic.js';

describe('Thiever food banking', () => {
    test('banking is opt-in', () => {
        expect(THIEVER_BANKING_OPTIONS).toEqual(['None', 'Auto']);
        expect(autoFoodBanking('Auto')).toBe(true);
        expect(autoFoodBanking(' none ')).toBe(false);
    });

    test('food matching retains the existing case-insensitive contains behavior', () => {
        expect(foodMatches('2/3 cake', 'cake')).toBe(true);
        expect(foodMatches('Lobster', 'CAKE')).toBe(false);
        expect(foodMatches('Cake', '')).toBe(false);
        expect(
            countFood(
                [
                    { name: 'Cake', count: 1 },
                    { name: 'Slice of cake', count: 2 },
                    { name: 'Coins', count: 50 }
                ],
                'cake'
            )
        ).toBe(3);
    });

    test('auto banking triggers at the food floor or a full pack with bankable items', () => {
        expect(shouldRestockFood(true, 1, 1, false)).toBe(true);
        expect(shouldRestockFood(true, 2, 1, false)).toBe(false);
        expect(shouldRestockFood(true, 10, 1, true)).toBe(true);
        expect(shouldRestockFood(false, 0, 1, true)).toBe(false);
    });

    test('low health without food blocks another pickpocket attempt', () => {
        expect(safeToSteal(0.49, 0.5, 0)).toBe(false);
        expect(safeToSteal(0.49, 0.5, 1)).toBe(true);
        expect(safeToSteal(0.5, 0.5, 0)).toBe(true);
    });
});

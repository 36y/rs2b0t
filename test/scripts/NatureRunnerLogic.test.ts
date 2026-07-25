import { expect, test, describe } from 'bun:test';

import { planStoreStep, offerCount, coinTargetFor, TRADE_CAP, BUY_ONLY_STOCK, LOW_COINS, MIN_COIN_TARGET } from '#/bot/scripts/NatureRunnerLogic.js';

describe('planStoreStep (one store action per pass, re-planned against live stock)', () => {
    test('holding the full trade cap = done, regardless of stock', () => {
        expect(planStoreStep(0, 40, TRADE_CAP)).toEqual({ op: 'done' });
        expect(planStoreStep(100, 0, TRADE_CAP + 1)).toEqual({ op: 'done' });
    });

    test('over-stocked shop (>30) = buy-only, never sell', () => {
        expect(planStoreStep(BUY_ONLY_STOCK + 1, 40, 0)).toEqual({ op: 'buy', n: 25 });
        expect(planStoreStep(100, 40, 10)).toEqual({ op: 'buy', n: 15 });
    });

    test('at exactly 30 stock the deficit rule applies (deficit 0, so buy)', () => {
        expect(planStoreStep(BUY_ONLY_STOCK, 40, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('empty shop = classic sell-then-buy-back', () => {
        expect(planStoreStep(0, 40, 0)).toEqual({ op: 'sell', n: 25 });
        expect(planStoreStep(25, 15, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('partial stock sells only the deficit', () => {
        expect(planStoreStep(20, 40, 0)).toEqual({ op: 'sell', n: 5 });
    });

    test('shop ran dry mid-buy: sell exactly what is missing to reach 25', () => {
        expect(planStoreStep(0, 40, 17)).toEqual({ op: 'sell', n: 8 });
    });

    test('sell is bounded by the notes actually held', () => {
        expect(planStoreStep(0, 3, 0)).toEqual({ op: 'sell', n: 3 });
    });

    test('no notes left: buy whatever stock exists', () => {
        expect(planStoreStep(10, 0, 0)).toEqual({ op: 'buy', n: 10 });
    });

    test('nothing to sell, nothing to buy = done (leave with a partial load)', () => {
        expect(planStoreStep(0, 0, 10)).toEqual({ op: 'done' });
    });
});

describe('coinTargetFor (a restock must clear the low-coin floor by a whole trip)', () => {
    test('keeps a generous setting as-is', () => {
        expect(coinTargetFor(10000)).toBe(10000);
    });

    test('a target at or under the floor would ping-pong bank<->boat, so it is raised', () => {
        expect(coinTargetFor(LOW_COINS)).toBe(MIN_COIN_TARGET);
        expect(coinTargetFor(0)).toBe(MIN_COIN_TARGET);
        expect(coinTargetFor(-5)).toBe(MIN_COIN_TARGET);
    });

    test('the floor always has room above it for fares plus a buy-back', () => {
        expect(MIN_COIN_TARGET).toBeGreaterThan(LOW_COINS * 2);
    });
});

describe('offerCount (trade-window law: never more than 25)', () => {
    test('caps at TRADE_CAP', () => {
        expect(offerCount(52)).toBe(25);
        expect(offerCount(26)).toBe(25);
    });

    test('offers what is held when under the cap', () => {
        expect(offerCount(17)).toBe(17);
        expect(offerCount(25)).toBe(25);
        expect(offerCount(0)).toBe(0);
    });
});

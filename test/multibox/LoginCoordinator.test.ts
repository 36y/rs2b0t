import { describe, expect, test } from 'bun:test';
import { LoginCoordinator } from '#/bot/multibox/LoginCoordinator.js';

describe('LoginCoordinator', () => {
    test('spaces permits and stops before the server rejects a fifth UID attempt', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });

        expect(coordinator.requestPermit()).toBe(true);
        expect(coordinator.requestPermit()).toBe(false);

        for (let permit = 2; permit <= 4; permit++) {
            now += 1000;
            expect(coordinator.requestPermit()).toBe(true);
        }

        now += 1000;
        expect(coordinator.requestPermit()).toBe(false);
    });

    test('measures the server TTL cooldown from the latest permit', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        for (let permit = 0; permit < 4; permit++) {
            now = permit * 1000;
            expect(coordinator.requestPermit()).toBe(true);
        }

        now = 16000;
        expect(coordinator.requestPermit()).toBe(false);
        now = 19000;
        expect(coordinator.requestPermit()).toBe(true);
    });

    test('an idle partial batch expires before the next permit', () => {
        let now = 100;
        const coordinator = new LoginCoordinator({ now: () => now });
        expect(coordinator.requestPermit()).toBe(true);

        now += 16000;
        expect(coordinator.requestPermit()).toBe(true);
        now += 1000;
        expect(coordinator.requestPermit()).toBe(true);
    });

    test('a server throttle blocks every client and later starts a fresh batch', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        expect(coordinator.requestPermit()).toBe(true);

        coordinator.holdFor(20000);
        now = 19999;
        expect(coordinator.requestPermit()).toBe(false);
        now = 20000;
        expect(coordinator.requestPermit()).toBe(true);
    });

    test('overlapping throttle reports only extend the shared hold', () => {
        let now = 1000;
        const coordinator = new LoginCoordinator({ now: () => now });
        coordinator.holdFor(20000);
        now = 5000;
        coordinator.holdFor(1000);
        now = 20000;
        expect(coordinator.requestPermit()).toBe(false);
        now = 21000;
        expect(coordinator.requestPermit()).toBe(true);
    });

    test('invalid clocks fail closed and invalid options are rejected', () => {
        expect(new LoginCoordinator({ now: () => Number.NaN }).requestPermit()).toBe(false);
        expect(
            new LoginCoordinator({
                now: () => {
                    throw new Error('clock');
                }
            }).requestPermit()
        ).toBe(false);
        expect(() => new LoginCoordinator({ batchSize: 0 })).toThrow(RangeError);
        expect(() => new LoginCoordinator({ spacingMs: -1 })).toThrow(RangeError);
        expect(() => new LoginCoordinator({ spacingMs: 10, cooldownMs: 5 })).toThrow(RangeError);
    });
});

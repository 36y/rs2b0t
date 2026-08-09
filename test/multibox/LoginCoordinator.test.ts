import { describe, expect, test } from 'bun:test';
import { LoginCoordinator } from '#/bot/multibox/LoginCoordinator.js';

describe('LoginCoordinator', () => {
    test('spaces permits and stops before the server rejects a fifth UID attempt', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const bot = coordinator.register();

        expect(bot.requestPermit()).toBe(true);
        expect(bot.requestPermit()).toBe(false);

        for (let permit = 2; permit <= 4; permit++) {
            now += 1000;
            expect(bot.requestPermit()).toBe(true);
        }

        now += 1000;
        expect(bot.requestPermit()).toBe(false);
    });

    test('measures the server TTL cooldown from the latest permit', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const bot = coordinator.register();
        for (let permit = 0; permit < 4; permit++) {
            now = permit * 1000;
            expect(bot.requestPermit()).toBe(true);
        }

        now = 16000;
        expect(bot.requestPermit()).toBe(false);
        now = 19000;
        expect(bot.requestPermit()).toBe(true);
    });

    test('an idle partial batch expires before the next permit', () => {
        let now = 100;
        const coordinator = new LoginCoordinator({ now: () => now });
        const bot = coordinator.register();
        expect(bot.requestPermit()).toBe(true);

        now += 16000;
        expect(bot.requestPermit()).toBe(true);
        now += 1000;
        expect(bot.requestPermit()).toBe(true);
    });

    test('a server throttle blocks every client and later starts a fresh batch', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const bot = coordinator.register();
        expect(bot.requestPermit()).toBe(true);

        coordinator.holdFor(20000);
        now = 19999;
        expect(bot.requestPermit()).toBe(false);
        now = 20000;
        expect(bot.requestPermit()).toBe(true);
    });

    test('overlapping throttle reports only extend the shared hold', () => {
        let now = 1000;
        const coordinator = new LoginCoordinator({ now: () => now });
        const bot = coordinator.register();
        coordinator.holdFor(20000);
        now = 5000;
        coordinator.holdFor(1000);
        now = 20000;
        expect(bot.requestPermit()).toBe(false);
        now = 21000;
        expect(bot.requestPermit()).toBe(true);
    });

    test('keeps FIFO positions stable even when later bots poll faster', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const alice = coordinator.register();
        const bob = coordinator.register();
        const carol = coordinator.register();
        coordinator.holdFor(5000);

        expect(alice.requestPermit()).toBe(false);
        expect(bob.requestPermit()).toBe(false);
        expect(carol.requestPermit()).toBe(false);
        expect(alice.queueStatus()).toEqual({ position: 1, total: 3 });
        expect(bob.queueStatus()).toEqual({ position: 2, total: 3 });
        expect(carol.queueStatus()).toEqual({ position: 3, total: 3 });

        expect(carol.requestPermit()).toBe(false);
        expect(carol.requestPermit()).toBe(false);
        expect(carol.queueStatus()).toEqual({ position: 3, total: 3 });

        now = 5000;
        expect(carol.requestPermit()).toBe(false);
        expect(alice.requestPermit()).toBe(true);
        expect(alice.queueStatus()).toBeNull();
        expect(bob.queueStatus()).toEqual({ position: 1, total: 2 });
        expect(carol.queueStatus()).toEqual({ position: 2, total: 2 });

        now = 6000;
        expect(carol.requestPermit()).toBe(false);
        expect(bob.requestPermit()).toBe(true);
        expect(carol.queueStatus()).toEqual({ position: 1, total: 1 });
    });

    test('cancellation compacts the queue and re-enrollment joins the tail', () => {
        const coordinator = new LoginCoordinator({ now: () => 0 });
        const alice = coordinator.register();
        const bob = coordinator.register();
        const carol = coordinator.register();
        coordinator.holdFor(5000);
        alice.requestPermit();
        bob.requestPermit();
        carol.requestPermit();

        bob.leaveQueue();
        expect(carol.queueStatus()).toEqual({ position: 2, total: 2 });
        alice.leaveQueue();
        alice.leaveQueue();
        expect(carol.queueStatus()).toEqual({ position: 1, total: 1 });

        expect(bob.requestPermit()).toBe(false);
        expect(bob.queueStatus()).toEqual({ position: 2, total: 2 });
    });

    test('keeps the fifth client first through the exact batch cooldown boundary', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const clients = Array.from({ length: 6 }, () => coordinator.register());
        for (let i = 0; i < 4; i++) {
            now = i * 1000;
            expect(clients[i].requestPermit()).toBe(true);
        }

        expect(clients[4].requestPermit()).toBe(false);
        expect(clients[5].requestPermit()).toBe(false);
        expect(clients[4].queueStatus()).toEqual({ position: 1, total: 2 });
        expect(clients[5].queueStatus()).toEqual({ position: 2, total: 2 });

        now = 18999;
        expect(clients[5].requestPermit()).toBe(false);
        expect(clients[4].requestPermit()).toBe(false);
        now = 19000;
        expect(clients[5].requestPermit()).toBe(false);
        expect(clients[4].requestPermit()).toBe(true);
        expect(clients[5].queueStatus()).toEqual({ position: 1, total: 1 });
    });

    test('a later shared hold preserves existing order and accepts newcomers at the tail', () => {
        let now = 0;
        const coordinator = new LoginCoordinator({ now: () => now });
        const first = coordinator.register();
        const second = coordinator.register();
        const newcomer = coordinator.register();
        expect(first.requestPermit()).toBe(true);
        expect(first.requestPermit()).toBe(false);
        expect(second.requestPermit()).toBe(false);

        coordinator.holdFor(5000);
        now = 1000;
        coordinator.holdFor(10000);
        expect(newcomer.requestPermit()).toBe(false);
        expect(first.queueStatus()).toEqual({ position: 1, total: 3 });
        expect(second.queueStatus()).toEqual({ position: 2, total: 3 });
        expect(newcomer.queueStatus()).toEqual({ position: 3, total: 3 });

        now = 10999;
        expect(newcomer.requestPermit()).toBe(false);
        expect(first.requestPermit()).toBe(false);
        now = 11000;
        expect(first.requestPermit()).toBe(true);
        expect(second.queueStatus()).toEqual({ position: 1, total: 2 });
    });

    test('a denied one-shot client can leave without disturbing queued positions', () => {
        const coordinator = new LoginCoordinator({ now: () => 0 });
        const first = coordinator.register();
        const second = coordinator.register();
        const oneShot = coordinator.register();
        coordinator.holdFor(5000);
        first.requestPermit();
        second.requestPermit();

        expect(oneShot.requestPermit()).toBe(false);
        expect(oneShot.queueStatus()).toEqual({ position: 3, total: 3 });
        oneShot.leaveQueue();
        expect(first.queueStatus()).toEqual({ position: 1, total: 2 });
        expect(second.queueStatus()).toEqual({ position: 2, total: 2 });
    });

    test('invalid clocks fail closed and invalid options are rejected', () => {
        expect(new LoginCoordinator({ now: () => Number.NaN }).register().requestPermit()).toBe(false);
        expect(
            new LoginCoordinator({
                now: () => {
                    throw new Error('clock');
                }
            }).register().requestPermit()
        ).toBe(false);
        expect(() => new LoginCoordinator({ batchSize: 0 })).toThrow(RangeError);
        expect(() => new LoginCoordinator({ spacingMs: -1 })).toThrow(RangeError);
        expect(() => new LoginCoordinator({ spacingMs: 10, cooldownMs: 5 })).toThrow(RangeError);
    });
});

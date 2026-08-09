import { describe, expect, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { BotHost } from '#/bot/BotHost.js';
import { AutoRelogin } from '#/bot/runtime/AutoRelogin.js';
import type {
    LoginCoordination,
    LoginQueueStatus
} from '#/bot/runtime/LoginCoordination.js';

describe('AutoRelogin title-screen flag (#215)', () => {
    test('isAutoLogin mirrors setAutoLogin', () => {
        AutoRelogin.setAutoLogin(true);
        expect(AutoRelogin.isAutoLogin()).toBe(true);
        AutoRelogin.setAutoLogin(false);
        expect(AutoRelogin.isAutoLogin()).toBe(false);
    });
});

describe('AutoRelogin multibox permit state', () => {
    test('tracks denial and clears before login or when its inputs are cancelled', () => {
        const original = {
            ingame: reader.ingame,
            loginMessage: reader.loginMessage,
            login: actions.login
        };
        let permitsAvailable = false;
        let loginCalls = 0;
        let queueAtLogin = true;
        let deniedStatus: LoginQueueStatus = { position: 3, total: 3 };
        let currentQueueStatus: LoginQueueStatus | null = null;
        const coordination: LoginCoordination = {
            requestPermit: () => {
                if (!permitsAvailable) {
                    currentQueueStatus = deniedStatus;
                    return false;
                }
                currentQueueStatus = null;
                return true;
            },
            queueStatus: () => currentQueueStatus,
            leaveQueue: () => {
                currentQueueStatus = null;
            },
            holdFor: () => {}
        };

        try {
            reader.ingame = () => false;
            reader.loginMessage = () => '';
            actions.login = () => {
                queueAtLogin = AutoRelogin.loginQueueStatus() !== null;
                loginCalls++;
                return true;
            };
            AutoRelogin.setCredentials('queue-state-test', 'test');
            AutoRelogin.setLoginCoordination(coordination);
            AutoRelogin.setAutoLogin(true);
            AutoRelogin.enable();

            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 3, total: 3 });
            AutoRelogin.setLoginCoordination(coordination);
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 3, total: 3 });
            expect(loginCalls).toBe(0);

            currentQueueStatus = { position: 2, total: 2 };
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 2, total: 2 });
            currentQueueStatus = { position: 1, total: 1 };
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 1, total: 1 });
            permitsAvailable = true;
            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toBeNull();
            expect(queueAtLogin).toBe(false);
            expect(loginCalls).toBe(1);

            AutoRelogin.setAutoLogin(false);
            expect(AutoRelogin.loginQueueStatus()).toBeNull();
            permitsAvailable = false;
            deniedStatus = { position: 1, total: 1 };
            expect(AutoRelogin.loginNow()).toBe(false);
            expect(AutoRelogin.loginQueueStatus()).toBeNull();
            AutoRelogin.setAutoLogin(true);
            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 1, total: 1 });

            AutoRelogin.setCredentials('', '');
            expect(AutoRelogin.loginQueueStatus()).toBeNull();

            AutoRelogin.setCredentials('queue-state-test', 'test');
            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 1, total: 1 });
            AutoRelogin.setLoginCoordination(null);
            expect(currentQueueStatus).toBeNull();
            expect(AutoRelogin.loginQueueStatus()).toBeNull();

            AutoRelogin.setLoginCoordination(coordination);
            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toEqual({ position: 1, total: 1 });
            reader.ingame = () => true;
            BotHost.onFrame();
            expect(AutoRelogin.loginQueueStatus()).toBeNull();
        } finally {
            AutoRelogin.setAutoLogin(false);
            AutoRelogin.setCredentials('', '');
            AutoRelogin.setLoginCoordination(null);
            reader.ingame = original.ingame;
            reader.loginMessage = original.loginMessage;
            actions.login = original.login;
        }
    });
});

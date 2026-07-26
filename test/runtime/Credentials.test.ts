import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Credentials, type Creds } from '#/bot/runtime/Credentials.js';

const clear = () => sessionStorage.clear();
beforeEach(clear);
afterEach(clear);

describe('Credentials', () => {
    test('save updates storage and subscribers together', () => {
        const changes: Array<Creds | null> = [];
        const unsubscribe = Credentials.onChange(creds => changes.push(creds));

        Credentials.save('alice', 'new-password');
        expect(Credentials.get()).toEqual({ username: 'alice', password: 'new-password' });
        expect(changes).toEqual([{ username: 'alice', password: 'new-password' }]);
        unsubscribe();
    });

    test('unchanged saves do not emit duplicate updates', () => {
        let updates = 0;
        const unsubscribe = Credentials.onChange(() => updates++);

        Credentials.save('alice', 'password');
        Credentials.save('alice', 'password');
        expect(updates).toBe(1);
        unsubscribe();
    });

    test('clear removes stored credentials and updates subscribers', () => {
        Credentials.save('alice', 'password');
        const changes: Array<Creds | null> = [];
        const unsubscribe = Credentials.onChange(creds => changes.push(creds));

        Credentials.clear();
        expect(Credentials.get()).toBeNull();
        expect(changes).toEqual([null]);
        unsubscribe();
    });

    test('saving an empty username clears credentials', () => {
        Credentials.save('alice', 'password');
        Credentials.save('', 'ignored');
        expect(Credentials.get()).toBeNull();
    });
});

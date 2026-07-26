import { boxKey } from './box.js';

// Per-instance: sessionStorage (per tab; per iframe in the MultiBox via ?box=),
// never the origin-shared localStorage — else every tab logs in as whichever
// tab saved last.
const hasStorage = typeof sessionStorage !== 'undefined';

export interface Creds {
    username: string;
    password: string;
}

type CredentialsListener = (creds: Creds | null) => void;
const listeners = new Set<CredentialsListener>();

function notify(creds: Creds | null): void {
    for (const listener of listeners) {
        listener(creds ? { ...creds } : null);
    }
}

export const Credentials = {
    get(): Creds | null {
        if (!hasStorage) {
            return null;
        }
        const raw = sessionStorage.getItem(boxKey('creds'));
        if (!raw) {
            return null;
        }
        try {
            const c = JSON.parse(raw) as Creds;
            return typeof c.username === 'string' && typeof c.password === 'string' && c.username.length > 0 ? c : null;
        } catch {
            return null;
        }
    },

    save(username: string, password: string): void {
        if (username.length === 0) {
            this.clear();
            return;
        }
        const next = { username, password };
        const current = this.get();
        if (current?.username === username && current.password === password) {
            return;
        }
        if (hasStorage) {
            sessionStorage.setItem(boxKey('creds'), JSON.stringify(next));
        }
        notify(next);
    },

    clear(): void {
        const hadCredentials = this.get() !== null;
        if (hasStorage) {
            sessionStorage.removeItem(boxKey('creds'));
        }
        if (hadCredentials) {
            notify(null);
        }
    },

    onChange(listener: CredentialsListener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

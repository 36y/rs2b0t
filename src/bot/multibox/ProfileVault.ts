export interface Profile {
    username: string;
    password: string;
}

export type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';
const ITER = 310000;

const hasLocal = typeof localStorage !== 'undefined';

interface StoredBlob {
    v: number;
    kdf: string;
    iter: number;
    salt: string;
    iv: string;
    ct: string;
}

function b64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) {
        s += String.fromCharCode(b);
    }
    return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

function parseBlob(raw: string | null): StoredBlob | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as StoredBlob;
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            return null;
        }
        return v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string' && typeof v.iter === 'number' ? v : null;
    } catch {
        return null;
    }
}

function parseLegacy(raw: string | null): Profile[] | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as Profile[];
        if (!Array.isArray(v)) {
            return null;
        }
        return v
            .filter(p => typeof p?.username === 'string' && p.username.length > 0 && typeof p?.password === 'string')
            .map(p => ({ username: p.username, password: p.password }));
    } catch {
        return null;
    }
}

async function deriveKey(pass: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export class ProfileVault {
    private cache: Profile[] | null = null;
    private key: CryptoKey | null = null;
    private salt: Uint8Array<ArrayBuffer> | null = null;

    status(): VaultStatus {
        if (this.cache) {
            return 'unlocked';
        }
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        if (parseBlob(raw)) {
            return 'locked';
        }
        if (parseLegacy(raw)) {
            return 'plaintext-legacy';
        }
        if (hasLocal && parseLegacy(localStorage.getItem(LEGACY_KEY))) {
            return 'plaintext-legacy';
        }
        return 'empty';
    }

    async setup(pass: string): Promise<void> {
        if (this.status() === 'locked') {
            throw new Error('vault is locked — unlock or reset first');
        }
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        const legacy = parseLegacy(raw) ?? (hasLocal ? parseLegacy(localStorage.getItem(LEGACY_KEY)) : null) ?? [];
        this.salt = crypto.getRandomValues(new Uint8Array(16));
        this.key = await deriveKey(pass, this.salt, ITER);
        this.cache = legacy;
        if (hasLocal) {
            localStorage.removeItem(LEGACY_KEY);
        }
        await this.persist();
    }

    async unlock(pass: string): Promise<boolean> {
        const blob = parseBlob(hasLocal ? localStorage.getItem(KEY) : null);
        if (!blob) {
            return false;
        }
        const salt = unb64(blob.salt);
        const key = await deriveKey(pass, salt, blob.iter);
        try {
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
            this.cache = parseLegacy(new TextDecoder().decode(pt)) ?? [];
            this.key = key;
            this.salt = salt;
            return true;
        } catch {
            return false;
        }
    }

    reset(): void {
        if (hasLocal) {
            localStorage.removeItem(KEY);
            localStorage.removeItem(LEGACY_KEY);
        }
        this.cache = null;
        this.key = null;
        this.salt = null;
    }

    list(): Profile[] {
        return this.assertUnlocked().map(p => ({ ...p }));
    }

    async upsert(p: Profile): Promise<void> {
        if (p.username.length === 0) {
            return;
        }
        const all = this.assertUnlocked();
        const i = all.findIndex(x => x.username === p.username);
        const entry = { username: p.username, password: p.password };
        if (i >= 0) {
            all[i] = entry;
        } else {
            all.push(entry);
        }
        await this.persist();
    }

    async remove(username: string): Promise<void> {
        this.cache = this.assertUnlocked().filter(x => x.username !== username);
        await this.persist();
    }

    private assertUnlocked(): Profile[] {
        if (!this.cache) {
            throw new Error('vault is not unlocked');
        }
        return this.cache;
    }

    private async persist(): Promise<void> {
        if (!hasLocal || !this.key || !this.salt || !this.cache) {
            return;
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(this.cache)));
        const blob: StoredBlob = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(this.salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
        localStorage.setItem(KEY, JSON.stringify(blob));
    }
}

export const vault = new ProfileVault();

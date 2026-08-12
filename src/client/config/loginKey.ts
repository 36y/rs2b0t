// The login modulus is baked at build time, but rs2b2t rotates its RSA keypair
// on restart. A stale modulus makes the server's rsadec produce garbage and it
// replies with login response 6 — "RuneScape has been updated!" — so the client
// re-fetches the live key and retries once. It reads the proxy's /loginkey where
// one is running, and otherwise the client bundle the game server serves itself,
// which is the only source a same-origin hosted client has.

const BAKED_MODULUS = process.env.LOGIN_RSAN ?? '';
const EXPONENT = process.env.LOGIN_RSAE ?? '65537';
const CLIENT_BUNDLE = '/client/client.js';

let modulus = BAKED_MODULUS;

export function loginModulus(): bigint {
    return BigInt(modulus);
}

export function loginExponent(): bigint {
    return BigInt(EXPONENT);
}

export function parseLoginModulus(text: string): string | null {
    const match = /^\d{250,}$/.exec(text.trim());
    return match ? match[0] : null;
}

// parseLoginModulus is anchored and cannot read a minified bundle; loosening it
// would let the plain-text endpoint accept noise, so the fallback gets its own.
export function extractLoginModulus(text: string): string | null {
    const match = /\d{250,}/.exec(text);
    return match ? match[0] : null;
}

async function readModulus(url: string, extract: (text: string) => string | null): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }

        return extract(await res.text());
    } catch (_e) {
        return null;
    }
}

export async function refreshLoginKey(): Promise<boolean> {
    const next = (await readModulus('/loginkey', parseLoginModulus)) ?? (await readModulus(CLIENT_BUNDLE, extractLoginModulus));
    if (!next || next === modulus) {
        return false;
    }

    modulus = next;
    return true;
}

export function resetLoginKey(): void {
    modulus = BAKED_MODULUS;
}

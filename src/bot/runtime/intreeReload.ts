import { ScriptRegistry, type ScriptMeta } from './ScriptRegistry.js';
import { ScriptRunner } from './ScriptRunner.js';

interface ScriptBuildManifest {
    version: string;
    runtimeChunks: string[];
}

let baselineChunks: string | null = null;
const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

export async function initializeInTreeScripts(): Promise<void> {
    await reloadInTreeScripts();
}
let registered = new Set<string>();
let loadedVersion: string | null = null;
let importSequence = 0;
let busy = false;

function safeToReload(): void {
    const state = ScriptRunner.state;
    if (state === 'running' || state === 'paused' || state === 'stopping') {
        throw new Error('Stop the current script before reloading InTree scripts.');
    }
}

/**
 * Reloads the separately compiled InTree entrypoint. Shared runtime chunks
 * must match the ones already running in the page; changes to the host require
 * a full page reload instead of creating duplicate singleton instances.
 */
export async function reloadInTreeScripts(): Promise<number> {
    safeToReload();
    if (busy) throw new Error('An InTree script reload is already in progress.');
    busy = true;
    try {
        const response = await fetch('./bot/intree-scripts.json?reload=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('Cannot fetch InTree build manifest (HTTP ' + response.status + ')');
        const manifest = await response.json() as ScriptBuildManifest;
        if (!manifest || typeof manifest.version !== 'string' || !Array.isArray(manifest.runtimeChunks)) {
            throw new Error('Invalid InTree build manifest.');
        }
        const fingerprint = JSON.stringify(manifest.runtimeChunks);
        if (baselineChunks !== null && fingerprint !== baselineChunks) {
            throw new Error('Shared client code changed. Reload the browser page once before loading these scripts.');
        }

        // Browsers cache successful module imports by URL. Importing the same
        // version again does not rerun its registration side effects.
        if (loadedVersion === manifest.version && registered.size > 0) {
            return registered.size;
        }

        // Capture registrations in isolation. A failed import must not remove
        // previously working scripts from the library.
        const previousRegister = ScriptRegistry.register.bind(ScriptRegistry);
        const next = new Map<string, ScriptMeta>();
        ScriptRegistry.register = (meta: ScriptMeta) => { next.set(meta.name, meta); };
        try {
            // A version may recur (A → B → A). Give each actual import a fresh
            // URL so the browser reruns its registration side effects.
            const importUrl = new URL('./bot/intree-scripts.js', document.baseURI);
            importUrl.searchParams.set('version', manifest.version);
            importUrl.searchParams.set('load', String(++importSequence));
            await dynamicImport(importUrl.href);
        } finally {
            ScriptRegistry.register = previousRegister;
        }
        safeToReload();
        if (next.size === 0) throw new Error('InTree script bundle registered no scripts.');
        for (const name of registered) {
            if (ScriptRegistry.get(name)?.origin === 'intree-reload') ScriptRegistry.unregister(name);
        }
        for (const meta of next.values()) {
            ScriptRegistry.register({ ...meta, origin: 'intree-reload' });
        }
        registered = new Set(next.keys());
        baselineChunks = fingerprint;
        loadedVersion = manifest.version;
        return next.size;
    } finally {
        busy = false;
    }
}

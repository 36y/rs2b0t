/**
 * Shared helpers for operator nav live harnesses (tools/nav-*-live.ts, nav-*-smoke.ts).
 * Test/tooling only — not product runtime.
 *
 * Covers: cheat tele placement, energy, tick rate, path paint settings,
 * inventory seed (runes/jewellery), and a generic walkTo probe loop.
 */
import type { Page } from 'playwright-core';

import { setSettings } from './harness.js';
import { cheatQuiet } from '../tutorial/harness.js';

// ── types ───────────────────────────────────────────────────────────────────

export type NavTile = { x: number; z: number; level: number };

export type NavWalkResult = {
    walkOk: boolean;
    tile: NavTile | null;
    logs: string[];
};

export type NavPaintFlags = {
    paint: boolean;
    sceneExpand: boolean;
    clientSeg: boolean;
    /** Product tele catalog preference in SettingsStore (navTeleports). */
    teleports: boolean;
    /** Yaw-follow camera while painting. Default true when paint is on. */
    cameraFollow: boolean;
    pathColor: string;
    clientColor: string;
};

export type SeedSpec = {
    debug: string;
    /** Charged display name (e.g. /Amulet of glory\(/). */
    match: RegExp;
    /**
     * Depleted form with no charge paren (e.g. /^Amulet of glory$/).
     * When present, top-up drops these to free slots before re-seeding charged.
     */
    uncharged?: RegExp;
    qty?: number;
    label?: string;
};

// ── env ─────────────────────────────────────────────────────────────────────

/** True unless env is explicitly "0" or "false". */
export function envDefaultOn(name: string): boolean {
    const v = process.env[name];
    return v !== '0' && v !== 'false';
}

/** True only when env is "1" or "true". */
export function envDefaultOff(name: string): boolean {
    const v = process.env[name];
    return v === '1' || v === 'true';
}

export function useTeleportsFromEnv(): boolean {
    return envDefaultOn('USE_TELEPORTS');
}

export function energyRefillAtFromEnv(fallback = 25): number {
    return Number(process.env.ENERGY_REFILL_AT ?? fallback);
}

/** PATH_PAINT / SCENE_EXPAND / CLIENT_SEG + tele flag for settings. */
export function pathPaintFlagsFromEnv(opts?: {
    /** Override teleports setting (default USE_TELEPORTS). */
    teleports?: boolean;
    /** When paint off, force cameraFollow false. Default: follow paint. */
    cameraFollow?: boolean;
}): NavPaintFlags {
    const paint = envDefaultOn('PATH_PAINT');
    const sceneExpand =
        paint
        && process.env.PATH_PAINT_SCENE_EXPAND !== '0'
        && process.env.PATH_PAINT_SCENE_EXPAND !== 'false';
    const clientSeg =
        paint
        && process.env.PATH_PAINT_CLIENT_SEG !== '0'
        && process.env.PATH_PAINT_CLIENT_SEG !== 'false';
    const teleports = opts?.teleports ?? useTeleportsFromEnv();
    const cameraFollow = opts?.cameraFollow ?? paint;
    return {
        paint,
        sceneExpand,
        clientSeg,
        teleports,
        cameraFollow,
        pathColor: '#FF0000',
        clientColor: '#00D4FF'
    };
}

// ── geometry / placement ────────────────────────────────────────────────────

export function cheb(a: NavTile, b: NavTile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function teleCmd(t: NavTile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

/**
 * Cheat-tele the character to `spot` (engine `tele` command).
 * This is placement seed, not a product spell/jewellery teleport.
 */
async function teleArriveExact(page: Page, spot: NavTile, maxDist: number): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => {
                const g = globalThis as never as {
                    __rs2b0t: { reader: { worldTile(): NavTile | null } };
                };
                return g.__rs2b0t.reader.worldTile();
            });
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(300);
                return;
            }
            await page.waitForTimeout(150);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z},L${spot.level} failed`);
}

/**
 * After placement, pick a walkable stand near `origin` (scene collision).
 * Script anchors often sit on solid locs (search furniture, digs, rocks).
 */
async function nearestWalkableStandLive(
    page: Page,
    origin: NavTile,
    radius = 3
): Promise<NavTile | null> {
    return page.evaluate(
        ({ origin: o, radius: r }) => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): NavTile | null };
                    Reachability?: { walkable(t: NavTile): boolean };
                };
            };
            const walkable = (t: NavTile): boolean => {
                try {
                    return g.__rs2b0t.Reachability?.walkable(t) ?? false;
                } catch {
                    return false;
                }
            };
            if (walkable(o)) {
                return o;
            }
            const me = g.__rs2b0t.reader.worldTile();
            if (me && me.level === o.level && walkable(me) && Math.max(Math.abs(me.x - o.x), Math.abs(me.z - o.z)) <= r) {
                return me;
            }
            for (let rad = 1; rad <= r; rad++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    for (let dz = -rad; dz <= rad; dz++) {
                        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) {
                            continue;
                        }
                        const t = { x: o.x + dx, z: o.z + dz, level: o.level };
                        if (walkable(t)) {
                            return t;
                        }
                    }
                }
            }
            return null;
        },
        { origin, radius }
    );
}

/**
 * Cheat-tele to a **walkable** stand at/near `spot`.
 * Never leaves the character on top of an unwalkable loc (search furniture, etc.).
 */
export async function teleArrive(page: Page, spot: NavTile, maxDist = 12): Promise<void> {
    await teleArriveExact(page, spot, maxDist);
    const stand = await nearestWalkableStandLive(page, spot, 3);
    if (!stand) {
        // Scene may not have flags yet; accept placement and let pathfinder snap.
        return;
    }
    if (stand.x === spot.x && stand.z === spot.z && stand.level === spot.level) {
        return;
    }
    await teleArriveExact(page, stand, maxDist);
}

// ── energy / tick ───────────────────────────────────────────────────────────

/** Client energy 0–100. Prefer Game.energy(). */
export async function readRunEnergy(page: Page): Promise<number> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Game?: { energy(): number };
                reader: { energy(): number };
            };
        };
        try {
            return g.__rs2b0t.Game?.energy() ?? g.__rs2b0t.reader.energy();
        } catch {
            return g.__rs2b0t.reader.energy();
        }
    });
}

/**
 * Full energy + run on via content debugproc `[debugproc,energy]` → `~energy`.
 * Plain `energy` is not an engine cheat and is silently ignored.
 */
export async function restoreRunEnergy(page: Page): Promise<boolean> {
    if (!(await cheatQuiet(page, '~energy', 400))) {
        return false;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        await page.waitForTimeout(250);
        const e = await readRunEnergy(page);
        if (e >= 90) {
            return true;
        }
        await cheatQuiet(page, '~energy', 300);
    }
    return (await readRunEnergy(page)) >= 90;
}

/** Mid-walk: refill when energy ≤ lowAt. Logs when it fires. */
export async function maybeRefillEnergy(page: Page, lowAt = 25): Promise<boolean> {
    const e = await readRunEnergy(page);
    if (e > lowAt) {
        return false;
    }
    const ok = await restoreRunEnergy(page);
    const after = await readRunEnergy(page);
    console.log(
        `    energy refill: ${e}% → ${after}% (threshold ≤${lowAt}${ok ? '' : ', ~energy may have been busy/p_finduid'})`
    );
    return ok;
}

export async function setTickRate(
    page: Page,
    ms: number,
    opts?: { strict?: boolean }
): Promise<void> {
    if (!(await cheatQuiet(page, `speed ${ms}`))) {
        throw new Error(`could not send speed ${ms}`);
    }
    const confirmed = await page.evaluate(expected => {
        const g = globalThis as never as {
            __rs2b0t: { reader: { chat(n: number): { text: string }[] } };
        };
        return g.__rs2b0t.reader.chat(16).some(l =>
            l.text.includes(`World speed was changed to ${expected}ms`)
        );
    }, ms);
    if (!confirmed) {
        if (opts?.strict !== false) {
            // Default soft: warn (travel-live style). Pass strict:true for throw.
        }
        if (opts?.strict === true) {
            throw new Error(`server did not confirm speed ${ms}ms`);
        }
        console.warn(`WARN: speed ${ms}ms not confirmed in chat`);
        return;
    }
    console.log(`  tick rate → ${ms}ms`);
}

// ── path paint settings ─────────────────────────────────────────────────────

/**
 * Dual red pack path + cyan client segment + optional camera follow / tele flag.
 * Applies both setSettings and SettingsStore.save (relog drops store).
 */
export async function applyNavPaintSettings(
    page: Page,
    flags: NavPaintFlags = pathPaintFlagsFromEnv()
): Promise<void> {
    await setSettings(page, 'Global', {
        showNavPath: flags.paint,
        navCameraFollow: flags.cameraFollow,
        navPathSceneExpand: flags.sceneExpand,
        navPathClientSegment: flags.clientSeg,
        navPathColorClient: flags.clientColor,
        navPathColorPath: flags.pathColor,
        navTeleports: flags.teleports
    });
    await page.evaluate(
        f => {
            const g = globalThis as never as {
                __rs2b0t: {
                    SettingsStore: { save(name: string, key: string, raw: string): void };
                };
            };
            const s = g.__rs2b0t.SettingsStore;
            s.save('Global', 'showNavPath', f.paint ? 'true' : 'false');
            s.save('Global', 'navCameraFollow', f.cameraFollow ? 'true' : 'false');
            s.save('Global', 'navPathSceneExpand', f.sceneExpand ? 'true' : 'false');
            s.save('Global', 'navPathClientSegment', f.clientSeg ? 'true' : 'false');
            s.save('Global', 'navPathColorClient', f.clientColor);
            s.save('Global', 'navPathColorPath', f.pathColor);
            s.save('Global', 'navTeleports', f.teleports ? 'true' : 'false');
        },
        {
            paint: flags.paint,
            sceneExpand: flags.sceneExpand,
            clientSeg: flags.clientSeg,
            cameraFollow: flags.cameraFollow,
            teleports: flags.teleports,
            clientColor: flags.clientColor,
            pathColor: flags.pathColor
        }
    );
}

// ── inventory seed (tele kit) ───────────────────────────────────────────────

/** Charged jewellery for real OD Rub (plan scans inventory names). */
export const JEWELLERY_SEEDS: readonly SeedSpec[] = [
    {
        debug: 'ring_of_dueling_8',
        match: /Ring of dueling\(/,
        uncharged: /^Ring of dueling$/,
        label: 'duel ring'
    },
    {
        debug: 'amulet_of_glory_4',
        match: /Amulet of glory\(/,
        uncharged: /^Amulet of glory$/,
        label: 'glory'
    },
    {
        debug: 'necklace_of_minigames_8',
        match: /Games necklace\(/,
        uncharged: /^Games necklace$/,
        label: 'games neck'
    }
];

export const RUNE_SEEDS: readonly SeedSpec[] = [
    { debug: 'lawrune', match: /Law rune/i, qty: 80 },
    { debug: 'airrune', match: /Air rune/i, qty: 200 },
    { debug: 'firerune', match: /Fire rune/i, qty: 80 },
    { debug: 'waterrune', match: /Water rune/i, qty: 80 },
    { debug: 'earthrune', match: /Earth rune/i, qty: 80 }
];

export async function invHas(page: Page, match: RegExp): Promise<boolean> {
    return page.evaluate(pattern => {
        const g = globalThis as never as {
            __rs2b0t: { Inventory: { items(): { name: string | null }[] } };
        };
        const rx = new RegExp(pattern, 'i');
        return g.__rs2b0t.Inventory.items().some(it => it.name !== null && rx.test(it.name));
    }, match.source);
}

export async function invIsFull(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: { Inventory: { isFull(): boolean } };
        };
        return g.__rs2b0t.Inventory.isFull();
    });
}

/**
 * Drop backpack items whose display name matches `match` (e.g. uncharged glory).
 * Returns how many Drop ops were attempted.
 */
export async function dropInvMatching(page: Page, match: RegExp): Promise<number> {
    const dropped = await page.evaluate(async pattern => {
        const g = globalThis as never as {
            __rs2b0t: {
                Inventory: {
                    items(): { name: string | null; interact(action: string): boolean | Promise<boolean> }[];
                };
            };
        };
        const rx = new RegExp(pattern, 'i');
        let n = 0;
        // Snapshot names first — Drop mutates the list mid-iteration.
        const names = g.__rs2b0t.Inventory.items()
            .map(it => it.name)
            .filter((name): name is string => name !== null && rx.test(name));
        for (const name of names) {
            const item = g.__rs2b0t.Inventory.items().find(it => it.name === name);
            if (!item) {
                continue;
            }
            try {
                await item.interact('Drop');
                n++;
            } catch {
                /* mid-script drop can race; caller may retry seed */
            }
        }
        return n;
    }, match.source);
    if (dropped > 0) {
        await page.waitForTimeout(400);
    }
    return dropped;
}

/** Drop depleted charge jewellery so `give` can place charged copies. */
export async function dropUnchargedJewellery(page: Page, specs: readonly SeedSpec[] = JEWELLERY_SEEDS): Promise<number> {
    let total = 0;
    for (const j of specs) {
        if (j.uncharged) {
            total += await dropInvMatching(page, j.uncharged);
        }
    }
    return total;
}

/**
 * Seed inventory via engine `give` (no p_finduid busy-guard).
 * Content `~item` silently no-ops while mid-script after long walks.
 * `debugOrCmd` accepts bare debug name, "name qty", or legacy "~item name qty".
 */
export async function seedItem(
    page: Page,
    debugOrCmd: string,
    displayMatch: string | RegExp,
    qty = 1,
    tries = 8
): Promise<void> {
    const re =
        typeof displayMatch === 'string'
            ? new RegExp(displayMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            : displayMatch;
    const m = /^(?:~item\s+)?(\S+)(?:\s+(\d+))?$/.exec(debugOrCmd.trim());
    const debugName = m?.[1] ?? debugOrCmd;
    const resolvedQty = m?.[2] !== undefined ? Number(m[2]) : qty;
    const cmds = [`give ${debugName} ${resolvedQty}`, `~item ${debugName} ${resolvedQty}`];
    for (let i = 0; i < tries; i++) {
        await cheatQuiet(page, cmds[i % cmds.length]!);
        for (let poll = 0; poll < 4; poll++) {
            await page.waitForTimeout(200);
            const ok = await page.evaluate(pattern => {
                const g = globalThis as never as {
                    __rs2b0t: { Inventory: { items(): { name: string | null }[] } };
                };
                const rx = new RegExp(pattern, 'i');
                return g.__rs2b0t.Inventory.items().some(
                    it => it.name !== null && rx.test(it.name)
                );
            }, re.source);
            if (ok) {
                return;
            }
        }
    }
    const inv = await page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Inventory: { items(): { count?: number; name: string | null }[] };
            };
        };
        return g.__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => `${i.count ?? 1}× ${i.name}`)
            .join(', ');
    });
    throw new Error(
        `could not seed ${debugName} via give/~item (want ~ ${re}); inv=${inv || 'empty'}`
    );
}

export async function seedRunes(page: Page): Promise<void> {
    for (const r of RUNE_SEEDS) {
        if (!(await invHas(page, r.match))) {
            await seedItem(page, r.debug, r.match, r.qty ?? 1);
        }
    }
}

/**
 * Seed runes + charged jewellery so product walkTo may cast/Rub.
 * When useTeleports is false, still seeds runes (spell tests can re-enable).
 */
/**
 * Ensure one charged copy of each jewellery seed is present.
 * Drops depleted (no charge-paren) copies first so a full pack of uncharged
 * glories cannot block `give amulet_of_glory_4` (#555 / P10).
 */
export async function ensureJewellery(
    page: Page,
    opts?: { useTeleports?: boolean }
): Promise<void> {
    const useTele = opts?.useTeleports ?? useTeleportsFromEnv();
    if (!useTele) {
        return;
    }
    for (const j of JEWELLERY_SEEDS) {
        if (await invHas(page, j.match)) {
            continue;
        }
        if (j.uncharged && (await invHas(page, j.uncharged))) {
            await dropInvMatching(page, j.uncharged);
        }
        // Pack may still be full of other uncharged jewellery — free those too.
        if (await invIsFull(page)) {
            await dropUnchargedJewellery(page);
        }
        await seedItem(page, j.debug, j.match, 1);
    }
}

export async function seedTeleKit(
    page: Page,
    stamp: () => string,
    opts?: { useTeleports?: boolean }
): Promise<void> {
    const useTele = opts?.useTeleports ?? useTeleportsFromEnv();
    await seedRunes(page);
    if (useTele) {
        await ensureJewellery(page, { useTeleports: true });
        console.log(
            `${stamp()} seeded tele kit: runes + ${JEWELLERY_SEEDS.map(j => j.label).join(', ')} (real OD may Rub)`
        );
    } else {
        console.log(`${stamp()} seeded tele runes only (USE_TELEPORTS=0)`);
    }
}

// ── generic walkTo probe ────────────────────────────────────────────────────

export type RunNavWalkOpts = {
    dest: NavTile;
    budgetMs: number;
    radius?: number;
    useTeleports?: boolean;
    distanceBeforeTeleport?: number;
    allowTeleportIds?: string[];
    /** globalThis key for result (default __navLiveWalk). */
    resultKey?: string;
    scriptNamePrefix?: string;
    /** When set, mid-walk energy watch refills at this threshold. */
    energyRefillAt?: number;
    /** Log mid-walk position every N seconds (default 20). 0 = off. */
    progressEverySec?: number;
};

type WalkSlot = {
    walkOk: boolean;
    tile: NavTile | null;
    logs: string[];
};

/**
 * Stop the page runner if it is still active and wait until idle/stopped.
 * Required after harness poll timeout so the next leg can `start` (#554 / P1).
 */
export async function ensureRunnerStopped(
    page: Page,
    reason = 'harness stop',
    waitMs = 15_000
): Promise<void> {
    await page.evaluate(stopReason => {
        const g = globalThis as never as {
            rs2b0t?: { runner?: { state: string; stop(reason: string): void } };
        };
        const runner = g.rs2b0t?.runner;
        if (!runner) {
            return;
        }
        const state = runner.state;
        if (state === 'running' || state === 'paused' || state === 'stopping') {
            try {
                runner.stop(stopReason);
            } catch {
                /* already stopping / reason edge — next poll still waits */
            }
        }
    }, reason);

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        const state = await page.evaluate(() => {
            const g = globalThis as never as {
                rs2b0t?: { runner?: { state: string } };
            };
            return g.rs2b0t?.runner?.state ?? 'idle';
        });
        if (state === 'stopped' || state === 'idle' || state === 'crashed') {
            return;
        }
        await page.waitForTimeout(250);
    }
}

/**
 * Start a one-shot LoopingBot that calls Traversal.walkTo, poll until done.
 * Uses a configurable globalThis result slot so concurrent harnesses stay isolated.
 *
 * Always stops the runner before return (including poll timeout) so multi-leg
 * suites never cascade with `'Nav…' is still running`.
 */
export async function runNavWalk(page: Page, opts: RunNavWalkOpts): Promise<NavWalkResult> {
    const resultKey = opts.resultKey ?? '__navLiveWalk';
    const teleOn = opts.useTeleports !== false;
    const radius = opts.radius ?? 4;
    const progressEvery = opts.progressEverySec ?? 20;

    try {
        await page.evaluate(
            ({ destination, budgetMs, allowTeleportIds, distanceBeforeTeleport, teleOn, radius, resultKey, prefix }) => {
                const g = globalThis as never as Record<string, unknown> & {
                    __rs2b0t: {
                        reader: { worldTile(): NavTile | null };
                        LoopingBot: new () => { loop(): unknown; log(m: string): void };
                        Traversal: {
                            walkTo(
                                dest: NavTile,
                                o: {
                                    radius?: number;
                                    timeoutMs?: number;
                                    log?: (m: string) => void;
                                    useTeleportCatalog?: boolean;
                                    policy?: {
                                        useTeleports?: boolean;
                                        distanceBeforeTeleport?: number;
                                        allowTeleportIds?: string[];
                                    };
                                }
                            ): Promise<boolean>;
                        };
                        registerScript(m: { name: string; create(): unknown }): unknown;
                    };
                    rs2b0t: { runner: { start(meta: unknown): void; stop(reason: string): void } };
                };
                (g as Record<string, unknown>)[resultKey] = undefined;
                class Probe extends g.__rs2b0t.LoopingBot {
                    override async loop(): Promise<void> {
                        const logs: string[] = [];
                        try {
                            const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                                radius,
                                timeoutMs: budgetMs,
                                useTeleportCatalog: teleOn,
                                policy: {
                                    useTeleports: teleOn,
                                    distanceBeforeTeleport: distanceBeforeTeleport ?? 0,
                                    ...(allowTeleportIds ? { allowTeleportIds } : {})
                                },
                                log: m => {
                                    logs.push(m);
                                    this.log(m);
                                }
                            });
                            (g as Record<string, unknown>)[resultKey] = {
                                walkOk,
                                tile: g.__rs2b0t.reader.worldTile(),
                                logs
                            } satisfies WalkSlot;
                        } catch (e) {
                            (g as Record<string, unknown>)[resultKey] = {
                                walkOk: false,
                                tile: g.__rs2b0t.reader.worldTile(),
                                logs: [...logs, String(e)]
                            } satisfies WalkSlot;
                        } finally {
                            g.rs2b0t.runner.stop('harness stop');
                        }
                    }
                }
                g.rs2b0t.runner.start(
                    g.__rs2b0t.registerScript({
                        name: `${prefix}${Date.now()}`,
                        create: () => new Probe()
                    })
                );
            },
            {
                destination: opts.dest,
                budgetMs: opts.budgetMs,
                allowTeleportIds: opts.allowTeleportIds,
                distanceBeforeTeleport: opts.distanceBeforeTeleport,
                teleOn,
                radius,
                resultKey,
                prefix: opts.scriptNamePrefix ?? 'NavLive'
            }
        );

        for (let i = 0; i < Math.ceil(opts.budgetMs / 1000) + 40; i++) {
            const done = await page.evaluate(
                ({ resultKey }) => {
                    const g = globalThis as never as Record<string, unknown> & {
                        rs2b0t: { runner: { state: string } };
                    };
                    return (
                        g[resultKey] !== undefined
                        && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
                    );
                },
                { resultKey }
            );
            if (done) {
                break;
            }
            if (opts.energyRefillAt !== undefined) {
                await maybeRefillEnergy(page, opts.energyRefillAt).catch(() => undefined);
            }
            if (progressEvery > 0 && i > 0 && i % progressEvery === 0) {
                const mid = await page.evaluate(() => {
                    const g = globalThis as never as {
                        __rs2b0t: { reader: { worldTile(): NavTile | null } };
                    };
                    return g.__rs2b0t.reader.worldTile();
                });
                const e = await readRunEnergy(page).catch(() => -1);
                console.log(`    …walking ${mid ? `${mid.x},${mid.z}` : '?'} energy=${e}%`);
            }
            await page.waitForTimeout(1000);
        }
    } finally {
        // Poll timeout (or evaluate throw) must not leave the runner running for the next leg.
        await ensureRunnerStopped(page, 'harness timeout').catch(() => undefined);
    }

    const result = await page.evaluate(
        ({ resultKey }) => {
            const g = globalThis as never as Record<string, unknown>;
            const r = g[resultKey] as WalkSlot | undefined;
            delete g[resultKey];
            return r ?? null;
        },
        { resultKey }
    );
    if (!result) {
        return { walkOk: false, tile: null, logs: ['no result (timeout)'] };
    }
    return result;
}

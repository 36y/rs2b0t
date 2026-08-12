/**
 * Pure forward recovery on stall: prefer the furthest clickable tile ahead on
 * the same path chain instead of immediately repathing.
 */

import { chebyshev, type PathTileLike } from './geometry/followMath.js';

/**
 * Furthest index in [fromIdx+1, limitIdx] that is on the same level, within
 * corridor of `me` **or** clickable, preferring the highest index that is
 * clickable and not behind the player on the path.
 *
 * Returns -1 when nothing usable is found (caller should repath / door scan).
 */
export function findForwardRecoveryIndex(
    tiles: PathTileLike[],
    me: PathTileLike,
    fromIdx: number,
    isClickable: (t: PathTileLike) => boolean,
    opts?: { corridor?: number; window?: number; limitIdx?: number }
): number {
    if (tiles.length === 0) {
        return -1;
    }
    const corridor = opts?.corridor ?? 3;
    const window = opts?.window ?? 40;
    const limitIdx = Math.min(opts?.limitIdx ?? tiles.length - 1, tiles.length - 1);
    const hi = Math.min(fromIdx + window, limitIdx);

    let bestClickable = -1;
    let bestOnCorridor = -1;
    for (let i = fromIdx + 1; i <= hi; i++) {
        const t = tiles[i]!;
        if (t.level !== me.level) {
            continue;
        }
        // Prefer tiles still ahead: not the tile we're standing on.
        if (t.x === me.x && t.z === me.z) {
            continue;
        }
        if (chebyshev(me, t) <= corridor) {
            bestOnCorridor = i;
        }
        if (isClickable(t)) {
            bestClickable = i;
        }
    }
    // Furthest clickable wins; else furthest corridor tile to re-anchor.
    if (bestClickable !== -1) {
        return bestClickable;
    }
    return bestOnCorridor;
}

/**
 * What a stalled walk should do next.
 *
 * `recover` — click further along the published path.
 * `combat`  — hold course; a fight, not a nav problem.
 * `escalate` — open a route door, dismiss a quest lock, or declare blocked/repath.
 *
 * The search window for {@link findForwardRecoveryIndex} is capped at the tile
 * *before* the next hop, so it is empty — `recoverIdx === -1` — exactly when the
 * walk has already reached that hop's approach. That is the door/stair case, and
 * it is the one that most needs the escalation ladder. Repathing there instead
 * just replans the same route and burns the repath budget until the walk reports
 * failure, which `walkResilient` then escalates to **unreachable**.
 */
export type StallPhase = 'recover' | 'combat' | 'escalate';

export function stallPhase(opts: { stallRetries: number; recoverIdx: number; inCombat: boolean }): StallPhase {
    if (opts.stallRetries === 0 && opts.recoverIdx !== -1) {
        return 'recover';
    }
    return opts.inCombat ? 'combat' : 'escalate';
}

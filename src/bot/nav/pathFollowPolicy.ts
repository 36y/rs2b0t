/**
 * Path stickiness: plan once when the walk is requested; repath only on stall,
 * deviation, or an explicit script/API force. Defaults match observed client vs
 * baked-path slop.
 */

import { SettingsStore } from '../runtime/Settings.js';

/** Default server ticks with no tile change before stall repath. */
export const DEFAULT_PATH_STALL_TICKS = 5;

/**
 * Default Chebyshev distance from the published path before deviation repath.
 */
export const DEFAULT_PATH_DEVIATION_CHEBYSHEV = 10;

/**
 * The corridor-snap radius (`WalkExecutor.CORRIDOR`). Path progress counts a tile
 * as reached from this far away, so any trigger below it opens a band where the
 * walker believes it is at a hop and refuses to cross it.
 */
export const PATH_CORRIDOR = 3;

/**
 * Engage a planned transport hop only when this close to its **approach** tile
 * (not the far landing, not “any nearby spirit tree”).
 *
 * **Must be ≥ {@link PATH_CORRIDOR}.** `locateOnPath` snaps `pathIdx` onto the
 * approach from up to `PATH_CORRIDOR` tiles away, and the click selector will
 * not target a tile at or before `pathIdx` — so between the trigger and the
 * corridor the walker emits zero clicks *and* skips the hop, and only a
 * `nearApproach` fallback saves the walk. Keeping the trigger at the arrival
 * radius closes that band.
 */
export const DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV = 4;

interface PathFollowConfig {
    /** Server ticks without a tile change → repath (default 5). */
    stallTicks: number;
    /** Chebyshev off the published path → repath (default 10). */
    deviationChebyshev: number;
    /** Chebyshev to hop approach tile before executing the hop (default 4). */
    transportApproachChebyshev: number;
}

export interface PathFollowOverrides {
    stallTicks?: number;
    deviationChebyshev?: number;
    transportApproachChebyshev?: number;
}

/** Resolve follow stickiness: walk opts → Global settings → defaults. */
export function resolvePathFollowConfig(over?: PathFollowOverrides | null): PathFollowConfig {
    let gStall = DEFAULT_PATH_STALL_TICKS;
    let gDev = DEFAULT_PATH_DEVIATION_CHEBYSHEV;
    try {
        const bag = SettingsStore.globalBag();
        gStall = bag.num('navPathStallTicks', DEFAULT_PATH_STALL_TICKS);
        gDev = bag.num('navPathDeviation', DEFAULT_PATH_DEVIATION_CHEBYSHEV);
    } catch {
        // Detached unit tests / pre-settings boot.
    }
    return {
        stallTicks: Math.max(1, over?.stallTicks ?? gStall),
        deviationChebyshev: Math.max(1, over?.deviationChebyshev ?? gDev),
        // Never below the corridor snap — see DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV.
        transportApproachChebyshev: Math.max(
            PATH_CORRIDOR,
            over?.transportApproachChebyshev ?? DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV
        )
    };
}

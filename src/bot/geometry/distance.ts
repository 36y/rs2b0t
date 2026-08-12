import type { WorldTile } from '../adapter/ClientAdapter.js';

/**
 * Straight-line (Euclidean) distance, ignoring plane.
 * Chebyshev (king-move) wrongly prefers Falador East over Edgeville from
 * Barbarian Village tin/coal — the walk is shorter north to Edge.
 */
export function bankDistance(from: WorldTile, bank: WorldTile): number {
    const dx = bank.x - from.x;
    const dz = bank.z - from.z;
    return Math.hypot(dx, dz);
}

import type Tile from '../../geometry/Tile.js';

/**
 * Something with right-click actions that can be operated by name.
 * @see docs/reference/api-entities.md
 */
export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Something with a world position and a distance from the local player.
 * @see docs/reference/api-entities.md
 */
export interface Locatable {
    tile(): Tile;
    distance(): number;
}

export function opIndex(ops: (string | null)[], action: string): number {
    const wanted = action.toLowerCase();
    for (let i = 0; i < ops.length; i++) {
        if (ops[i]?.toLowerCase() === wanted) {
            return i + 1;
        }
    }

    return -1;
}

export function presentOps(ops: (string | null)[]): string[] {
    return ops.filter((op): op is string => op !== null && op !== 'hidden');
}

import Tile from '../api/Tile.js';

export const START_POSITION = 'Start position';
export const CUSTOM_COORDINATES = 'Custom coordinates';
export const SPOT_OPTIONS = [START_POSITION, CUSTOM_COORDINATES];
export const BANKING_OPTIONS = ['Auto', 'None'];
export const DEFAULT_CUSTOM_SPOT = new Tile(3273, 3427, 0);

export function resolveKillingSpot(mode: string, start: Tile, custom: Tile): Tile {
    return Tile.from(mode.trim().toLowerCase() === CUSTOM_COORDINATES.toLowerCase() ? custom : start);
}

export function autoBankEnabled(mode: string): boolean {
    return mode.trim().toLowerCase() === 'auto';
}

export const DEFAULT_LOOT = [
    'clue scroll',
    'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
    'half of a key',
    'chaos talisman', 'nature talisman'
];

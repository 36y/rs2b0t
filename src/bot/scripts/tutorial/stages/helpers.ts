import { Execution } from '../../../api/execution/Execution.js';
import { Locs } from '../../../api/locs/Locs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { Input } from '../../../api/input/Input.js';

export const QUEST_GUIDE_DOOR = { x: 3086, z: 3126 };

export const MINE_Z = 9000;

export function doorAt(tile: { x: number; z: number }, pad = 2) {
    return Locs.query()
        .name('Door')
        .action('Open')
        .inside({ minX: tile.x - pad, maxX: tile.x + pad, minZ: tile.z - pad, maxZ: tile.z + pad });
}

export async function walkToward(tile: { x: number; z: number }): Promise<void> {
    const local = reader.toLocal(tile.x, tile.z);
    if (local) {
        Input.walk(local.lx, local.lz);
    }
    await Execution.delayTicks(4);
}

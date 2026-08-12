import { buildMaze, solveRoute, type MazeGraph, type MazeLoc } from './mazeGraph.js';
import { MAZE_LAYOUT, MAZE_LAYOUT_STRIDE } from './mazeLayout.js';

interface MazeRoute {
    spawn: { x: number; z: number };
    doors: { x: number; z: number }[];
}

let cached: MazeGraph | null = null;

/** The map square is static, so the graph is built once and reused. */
function graph(): MazeGraph {
    if (cached) {
        return cached;
    }
    const locs: MazeLoc[] = [];
    for (let i = 0; i < MAZE_LAYOUT.length; i += MAZE_LAYOUT_STRIDE) {
        locs.push({
            lx: MAZE_LAYOUT[i],
            lz: MAZE_LAYOUT[i + 1],
            id: MAZE_LAYOUT[i + 2],
            shape: MAZE_LAYOUT[i + 3],
            angle: MAZE_LAYOUT[i + 4]
        });
    }
    cached = buildMaze(locs);
    return cached;
}

/**
 * Solves a door route from wherever the player actually landed.
 *
 * This used to pick the nearest of four hardcoded corner spawns and return its
 * route unconditionally, however far away the player was. The event does not
 * only spawn on those four tiles: two live bots landed on (2905,4566) and
 * (2900,4567), were both handed the (2891,4555) route, and both sat forever on
 * a first door that is walled off from where they stood. Returning a route for
 * somewhere else is worse than returning none, so this solves the real spawn
 * and returns null when it cannot.
 */
export function selectRoute(me: { x: number; z: number }): MazeRoute | null {
    const doors = solveRoute(graph(), me);
    if (doors.length === 0) {
        return null;
    }
    return { spawn: { x: me.x, z: me.z }, doors };
}

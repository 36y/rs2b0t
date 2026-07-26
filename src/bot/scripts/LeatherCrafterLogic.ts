export const HARD_LEATHER_BURST = 10;

/**
 * Hard-leather bodies are crafted synchronously by the server. Send one
 * needle-on-leather action for each distinct inventory slot before yielding
 * to the next game tick, matching the ten-at-a-time interface recipes.
 */
export async function issueHardLeatherBurst<T>(targets: readonly T[], useNeedleOn: (target: T) => boolean | Promise<boolean>, limit = HARD_LEATHER_BURST): Promise<number> {
    let sent = 0;
    for (const target of targets.slice(0, Math.max(0, limit))) {
        if (!(await useNeedleOn(target))) {
            break;
        }
        sent++;
    }
    return sent;
}

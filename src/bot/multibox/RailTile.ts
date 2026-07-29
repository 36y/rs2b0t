import type { SlotSnapshot } from './types.js';

export function renderRailTile(tile: HTMLElement, slot: SlotSnapshot): void {
    const dot = tile.querySelector<HTMLElement>('.mbx-dot')!;
    const running = slot.ingame && slot.scriptState === 'running';
    dot.classList.toggle('is-running', running);
    dot.title = running
        ? 'logged in — script running'
        : slot.ingame
            ? `logged in — script ${slot.scriptState}`
            : 'logged out';
    tile.querySelector<HTMLElement>('.mbx-name')!.textContent = slot.player ?? slot.username;
}

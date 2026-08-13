// Why: scans are expensive, especially the 300 varps plus the inventory component walk.
// Why: the server already says when state changes via packets, so a cache of last snapshots is re-diffed per family only after a relevant opcode, a login seed, or a safety resync.

// Which producer tables need a rescan.
import { ServerProt } from '#/client/io/ServerProt.js';

type ProducerFamily = 'skills' | 'inventory' | 'varps' | 'chat';

export interface ProducerDirtyFlags {
    skills: boolean;
    inventory: boolean;
    varps: boolean;
    chat: boolean;
}

export function emptyDirty(all = false): ProducerDirtyFlags {
    return { skills: all, inventory: all, varps: all, chat: all };
}

export function anyDirty(d: ProducerDirtyFlags): boolean {
    return d.skills || d.inventory || d.varps || d.chat;
}

/**
 * Map a server packet opcode to dirty families; null when the packet does not affect producer tables (most traffic).
 * Why: {@link ServerProt} member access only, because const enums cannot be cast to objects.
 */
export function dirtyFamiliesForPacket(ptype: number): ProducerFamily[] | 'reset' | null {
    if (ptype === ServerProt.LOGOUT) {
        return 'reset';
    }
    if (
        ptype === ServerProt.UPDATE_INV_FULL ||
        ptype === ServerProt.UPDATE_INV_PARTIAL ||
        ptype === ServerProt.UPDATE_INV_STOP_TRANSMIT
    ) {
        return ['inventory'];
    }
    if (ptype === ServerProt.UPDATE_STAT) {
        return ['skills'];
    }
    if (ptype === ServerProt.VARP_SMALL || ptype === ServerProt.VARP_LARGE || ptype === ServerProt.VARP_SYNC) {
        return ['varps'];
    }
    // Game + private messages land in the chat buffer the producers scan.
    if (ptype === ServerProt.MESSAGE_GAME || ptype === ServerProt.MESSAGE_PRIVATE) {
        return ['chat'];
    }
    // Rebuild can reshuffle UI/state; re-seed everything cheaply once.
    if (ptype === ServerProt.REBUILD_NORMAL) {
        return ['skills', 'inventory', 'varps', 'chat'];
    }
    return null;
}

export function applyDirty(flags: ProducerDirtyFlags, families: readonly ProducerFamily[]): ProducerDirtyFlags {
    const next = { ...flags };
    for (const f of families) {
        next[f] = true;
    }
    return next;
}

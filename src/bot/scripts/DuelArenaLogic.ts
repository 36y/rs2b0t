import type { ChatLine, WorldTile } from '../adapter/ClientAdapter.js';
import type { CombatStyleResolution, MeleeCombatStyle } from '../api/CombatStyle.js';

export interface Rect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

// Six 25x15 fight pens from duel_arena_fight_zones and
// duel_arena_obstacle_fight_zones. A player in one pen must only target the
// other player in that same pen; other simultaneous duels share the scene.
export const DUEL_FIGHT_ARENAS: readonly Rect[] = [
    { minX: 3333, maxX: 3357, minZ: 3244, maxZ: 3258 },
    { minX: 3364, maxX: 3388, minZ: 3225, maxZ: 3239 },
    { minX: 3333, maxX: 3357, minZ: 3206, maxZ: 3220 },
    { minX: 3364, maxX: 3388, minZ: 3244, maxZ: 3258 },
    { minX: 3333, maxX: 3357, minZ: 3225, maxZ: 3239 },
    { minX: 3364, maxX: 3388, minZ: 3206, maxZ: 3220 }
];

const DUEL_ZONE: Rect = { minX: 3328, maxX: 3393, minZ: 3203, maxZ: 3325 };
export const DUEL_CHALLENGE_ANCHOR: WorldTile = { x: 3368, z: 3274, level: 0 };
export const CHALLENGE_INTERVAL_MS = 5000;
export const DUEL_NEGOTIATION_TIMEOUT_MS = 30_000;
export const DUEL_LOBBY_CENTER_RADIUS = 4;
export const MAX_FIGHT_ATTEMPTS = 4;
export const MAX_CENTER_SEEK_ATTEMPTS = 2;
export const BUSY_MESSAGE = /^other player is busy at the moment\.?$/i;

function inside(tile: WorldTile, area: Rect): boolean {
    return tile.level === 0 && tile.x >= area.minX && tile.x <= area.maxX && tile.z >= area.minZ && tile.z <= area.maxZ;
}

export function fightArenaAt(tile: WorldTile | null): Rect | null {
    return tile === null ? null : (DUEL_FIGHT_ARENAS.find(area => inside(tile, area)) ?? null);
}

export function fightArenaCenter(area: Rect): WorldTile {
    return {
        x: Math.floor((area.minX + area.maxX) / 2),
        z: Math.floor((area.minZ + area.maxZ) / 2),
        level: 0
    };
}

export function inDuelChallengeArea(tile: WorldTile | null): boolean {
    return tile !== null && inside(tile, DUEL_ZONE) && fightArenaAt(tile) === null;
}

export function duelRequesterAvailable(tile: WorldTile | null, inCombat: boolean): boolean {
    return !inCombat && inDuelChallengeArea(tile);
}

/** The lobby is larger than one scene; converge only when nobody is visible. */
export function shouldCenterDuelLobby(tile: WorldTile | null, visibleTargets: number): boolean {
    if (!inDuelChallengeArea(tile) || tile === null || visibleTargets > 0) {
        return false;
    }
    return Math.max(
        Math.abs(tile.x - DUEL_CHALLENGE_ANCHOR.x),
        Math.abs(tile.z - DUEL_CHALLENGE_ANCHOR.z)
    ) > DUEL_LOBBY_CENTER_RADIUS;
}

/** Train the stat with the larger remaining gap; Attack wins a true tie. */
export function targetMeleeStyle(attackLevel: number, strengthLevel: number, targetAttack: number, targetStrength: number): Extract<MeleeCombatStyle, 'attack' | 'strength'> {
    const attackGap = Math.max(0, targetAttack - attackLevel);
    const strengthGap = Math.max(0, targetStrength - strengthLevel);
    return strengthGap > attackGap ? 'strength' : 'attack';
}

export function duelTargetsReached(attackLevel: number, strengthLevel: number, targetAttack: number, targetStrength: number): boolean {
    return attackLevel >= targetAttack && strengthLevel >= targetStrength;
}

/** A fallback to Defence/Controlled violates this script's two-stat contract. */
export function exactTrainingMode(style: Extract<MeleeCombatStyle, 'attack' | 'strength'>, resolution: CombatStyleResolution | null): number | null {
    return resolution?.effective === style ? resolution.mode : null;
}

/** Accurate alone is not proof of melee: ranged interfaces also offer it. */
export function hasExactMeleeStyles(attack: CombatStyleResolution | null, strength: CombatStyleResolution | null): boolean {
    return exactTrainingMode('attack', attack) !== null && exactTrainingMode('strength', strength) !== null;
}

export interface FightAttemptSnapshot {
    selfTile: WorldTile | null;
    opponentTile: WorldTile | null;
    fightStarted: boolean;
    inCombat: boolean;
    attempts: number;
}

export interface FightSignalState {
    phase: 'await-3' | 'await-2' | 'await-1' | 'await-fight' | 'ready';
    lastText: string | null;
}

function normalizeOverhead(text: string | null): string | null {
    const normalized = text?.trim().toUpperCase() ?? '';
    return normalized.length > 0 ? normalized : null;
}

/** Treat text already present on arena entry as a baseline, never as an event. */
export function beginFightSignal(selfChat: string | null): FightSignalState {
    return { phase: 'await-3', lastText: normalizeOverhead(selfChat) };
}

/** Require the server's exact, freshly observed 3/2/1/FIGHT sequence. */
export function observeFightSignal(state: FightSignalState, selfChat: string | null): FightSignalState {
    if (state.phase === 'ready') {
        return state;
    }

    const message = normalizeOverhead(selfChat);
    if (message === state.lastText) {
        return state;
    }

    let phase: FightSignalState['phase'] = 'await-3';
    if (message === '3') {
        phase = 'await-2';
    } else if (state.phase === 'await-2' && message === '2') {
        phase = 'await-1';
    } else if (state.phase === 'await-1' && message === '1') {
        phase = 'await-fight';
    } else if (state.phase === 'await-fight' && message === 'FIGHT!') {
        phase = 'ready';
    }
    return { phase, lastText: message };
}

export function canSeekFightCenter(attempts: number): boolean {
    return attempts >= 0 && attempts < MAX_CENTER_SEEK_ATTEMPTS;
}

/**
 * The server-only duelstatus varp is not transmitted to the client. Arm Fight
 * from the server's observable FIGHT overhead instead.
 */
export function canAttemptDuelFight(snapshot: FightAttemptSnapshot): boolean {
    const selfArena = fightArenaAt(snapshot.selfTile);
    return selfArena !== null &&
        fightArenaAt(snapshot.opponentTile) === selfArena &&
        snapshot.fightStarted &&
        !snapshot.inCombat &&
        snapshot.attempts >= 0 &&
        snapshot.attempts < MAX_FIGHT_ATTEMPTS;
}

export function confirmedIncomingInvite(dispatched: boolean, interfaceOpened: boolean): boolean {
    return dispatched && interfaceOpened;
}

export function challengeResult(dispatched: boolean, interfaceOpened: boolean, busy: boolean): ChallengeResult {
    if (!dispatched) {
        return 'failed';
    }
    if (interfaceOpened) {
        return 'interface';
    }
    return busy ? 'busy' : 'sent';
}

/** A missing peer must not hold the two-screen handshake open forever. */
export function negotiationExpired(openedAt: number, now: number): boolean {
    return openedAt > 0 && now - openedAt >= DUEL_NEGOTIATION_TIMEOUT_MS;
}

/** Only type-8 duel-request chat lines are actionable; public text is ignored. */
export function duelInviter(line: ChatLine): string | null {
    if (line.type !== 8 || !/^wishes to duel with you\.?$/i.test(line.text.trim())) {
        return null;
    }
    const name = line.username?.trim() ?? '';
    return name.length > 0 ? name : null;
}

export type ChallengeResult = 'sent' | 'busy' | 'interface' | 'failed';

/** Wall-clock 5s cadence; a rejected busy target is immediately retryable. */
export class ChallengeCadence {
    private nextAt = 0;

    ready(now: number): boolean {
        return now >= this.nextAt;
    }

    record(result: ChallengeResult, sentAt: number): void {
        // The server briefly closes one handshake screen before opening the
        // next. Preserve the normal cadence after an interface opens so that
        // transient gap cannot inject a fresh Challenge into the same duel.
        this.nextAt = result === 'sent' || result === 'interface'
            ? sentAt + CHALLENGE_INTERVAL_MS
            : 0;
    }

    remaining(now: number): number {
        return Math.max(0, this.nextAt - now);
    }

    reset(): void {
        this.nextAt = 0;
    }
}

/** Stable round-robin selection keeps a crowded multibox from hammering one bot. */
export function challengeCandidate<T>(candidates: readonly T[], cursor: number): { candidate: T; nextCursor: number } | null {
    if (candidates.length === 0) {
        return null;
    }
    const index = ((Math.trunc(cursor) % candidates.length) + candidates.length) % candidates.length;
    return { candidate: candidates[index]!, nextCursor: index + 1 };
}

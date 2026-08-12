// docs/reference/multibox.md#login-coordination
import type {
    LoginCoordination,
    LoginCoordinationRegistry,
    LoginQueueStatus
} from '../runtime/LoginCoordination.js';

export const LOGIN_BATCH_SIZE = 4;
export const LOGIN_ATTEMPT_SPACING_MS = 1000;
export const LOGIN_BATCH_COOLDOWN_MS = 16000;

export interface LoginCoordinatorOptions {
    now?: () => number;
    batchSize?: number;
    spacingMs?: number;
    cooldownMs?: number;
}

/**
 * Coordinates login handshakes across every iframe in one multibox wall.
 *
 * The production server permits four attempts for one client UID, then rejects
 * the fifth until that UID has been idle for 15 seconds. The cooldown is measured
 * from the latest permit because each attempt refreshes the server-side TTL.
 * Denied clients retain FIFO order until they receive a permit or leave the queue.
 */
export class LoginCoordinator implements LoginCoordinationRegistry {
    private readonly now: () => number;
    private readonly batchSize: number;
    private readonly spacingMs: number;
    private readonly cooldownMs: number;
    private permitsInBatch = 0;
    private lastPermitAt: number | null = null;
    private blockedUntil = 0;
    private queue: object[] = [];

    constructor(options: LoginCoordinatorOptions = {}) {
        this.now = options.now ?? (() => performance.now());
        this.batchSize = options.batchSize ?? LOGIN_BATCH_SIZE;
        this.spacingMs = options.spacingMs ?? LOGIN_ATTEMPT_SPACING_MS;
        this.cooldownMs = options.cooldownMs ?? LOGIN_BATCH_COOLDOWN_MS;

        if (!Number.isSafeInteger(this.batchSize) || this.batchSize <= 0) {
            throw new RangeError('login batch size must be a positive safe integer');
        }
        if (!Number.isFinite(this.spacingMs) || this.spacingMs < 0) {
            throw new RangeError('login attempt spacing must be finite and non-negative');
        }
        if (!Number.isFinite(this.cooldownMs) || this.cooldownMs <= 0 || this.cooldownMs < this.spacingMs) {
            throw new RangeError('login batch cooldown must be finite and at least the attempt spacing');
        }
    }

    register(): LoginCoordination {
        const request = {};
        return {
            requestPermit: () => this.requestPermit(request),
            queueStatus: () => this.queueStatus(request),
            leaveQueue: () => this.cancel(request),
            holdFor: delayMs => this.holdFor(delayMs)
        };
    }

    private requestPermit(request: object): boolean {
        if (!this.queue.includes(request)) {
            this.queue.push(request);
        }

        const now = this.readNow();
        if (now === null || now < this.blockedUntil || this.queue[0] !== request) {
            return false;
        }

        if (this.lastPermitAt !== null && now - this.lastPermitAt >= this.cooldownMs) {
            this.permitsInBatch = 0;
            this.lastPermitAt = null;
        }

        if (this.permitsInBatch >= this.batchSize) {
            return false;
        }
        if (this.lastPermitAt !== null && now - this.lastPermitAt < this.spacingMs) {
            return false;
        }

        this.queue.shift();
        this.permitsInBatch++;
        this.lastPermitAt = now;
        return true;
    }

    private queueStatus(request: object): LoginQueueStatus | null {
        const index = this.queue.indexOf(request);
        if (index < 0) {
            return null;
        }
        return { position: index + 1, total: this.queue.length };
    }

    private cancel(request: object): void {
        const index = this.queue.indexOf(request);
        if (index >= 0) {
            this.queue.splice(index, 1);
        }
    }

    holdFor(delayMs: number): void {
        const now = this.readNow();
        if (now === null || !Number.isFinite(delayMs) || delayMs <= 0) {
            return;
        }
        this.blockedUntil = Math.max(this.blockedUntil, now + delayMs);
        this.permitsInBatch = 0;
        this.lastPermitAt = null;
    }

    private readNow(): number | null {
        try {
            const now = this.now();
            return Number.isFinite(now) ? now : null;
        } catch {
            return null;
        }
    }
}

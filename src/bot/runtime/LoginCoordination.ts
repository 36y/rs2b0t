export interface LoginQueueStatus {
    position: number;
    total: number;
}

export interface LoginCoordination {
    requestPermit(): boolean;
    queueStatus(): LoginQueueStatus | null;
    leaveQueue(): void;
    holdFor(delayMs: number): void;
}

export interface LoginCoordinationRegistry {
    register(): LoginCoordination;
}

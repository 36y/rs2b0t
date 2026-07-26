export interface LoginCoordination {
    requestPermit(): boolean;
    holdFor(delayMs: number): void;
}

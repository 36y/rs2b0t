interface GameMessage {
    seq: number;
    text: string;
}

export const CANT_REACH = /^i can't reach that/i;

const CAP = 64;

function matches(pattern: RegExp, text: string): boolean {
    pattern.lastIndex = 0;
    return pattern.test(text);
}

class GameMessagesImpl {
    private ring: GameMessage[] = [];
    private lastSeq = 0;

    record(text: string): void {
        this.ring.push({ seq: ++this.lastSeq, text });
        if (this.ring.length > CAP) {
            this.ring.shift();
        }
    }

    mark(): number {
        return this.lastSeq;
    }

    since(mark: number): GameMessage[] {
        return this.ring.filter(m => m.seq > mark);
    }

    sawSince(mark: number, pattern: RegExp): boolean {
        return this.ring.some(m => m.seq > mark && matches(pattern, m.text));
    }

    firstSince(mark: number, pattern: RegExp): GameMessage | undefined {
        return this.ring.find(m => m.seq > mark && matches(pattern, m.text));
    }

    /** Newest-first slice of the ring (for death / failure dumps). */
    recent(limit = 8): GameMessage[] {
        if (limit <= 0 || this.ring.length === 0) {
            return [];
        }
        return this.ring.slice(-limit).reverse();
    }

    reset(): void {
        this.ring = [];
        this.lastSeq = 0;
    }
}

export const GameMessages = new GameMessagesImpl();

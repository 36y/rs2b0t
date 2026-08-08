import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Skills } from '#/bot/api/hud/Skills.js';
import { paintState } from '#/bot/api/hud/paintLogic.js';
import DuelArena from '#/bot/scripts/DuelArena.js';

const NOW = 1_800_000_000_000;
const original = {
    now: Date.now,
    level: Skills.level,
    xp: Skills.xp
};

function stubContext(text: string[]): CanvasRenderingContext2D {
    return {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        fillRect: () => {},
        strokeRect: () => {},
        fillText: (value: string) => text.push(value),
        measureText: (value: string) => ({ width: value.length * 7.2 })
    } as never as CanvasRenderingContext2D;
}

function paintAt(runtimeMs: number): string[] {
    const text: string[] = [];
    const bot = new DuelArena();
    Object.assign(bot as unknown as { startedAt: number; xpAtStart: number }, {
        startedAt: NOW - runtimeMs,
        xpAtStart: 3_000
    });
    bot.onPaint(stubContext(text));
    return text;
}

beforeEach(() => {
    paintState.reset();
    Date.now = () => NOW;
    Skills.level = () => 50;
    Skills.xp = skill =>
        ({
            attack: 1_200,
            strength: 1_250,
            hitpoints: 1_150,
            defence: 1_000_000
        })[skill] ?? 0;
});

afterEach(() => {
    Date.now = original.now;
    Skills.level = original.level;
    Skills.xp = original.xp;
    paintState.reset();
});

describe('Duel Arena paint', () => {
    test('shows combined Attack, Strength, and Hitpoints XP per hour', () => {
        expect(paintAt(60 * 60_000)).toContain('XP/hr: 0.6k');
    });

    test('keeps the warm-up placeholder through the first thirty seconds', () => {
        expect(paintAt(30_000)).toContain('XP/hr: —');
    });
});

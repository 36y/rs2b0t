import { describe, expect, test, beforeEach } from 'bun:test';
import { RenderGateController } from '#/bot/runtime/RenderGate.js';

describe('RenderGate', () => {
    let gate: RenderGateController;

    beforeEach(() => {
        gate = new RenderGateController();
    });

    test('focused draws every frame', () => {
        expect(gate.shouldDraw(1)).toBe(true);
        gate.markDrawn(1);
        expect(gate.shouldDraw(2)).toBe(true);
    });

    test('hidden never draws', () => {
        gate.setMode('hidden');
        expect(gate.shouldDraw(1000)).toBe(false);
    });

    test('background throttles to the interval', () => {
        gate.backgroundIntervalMs = 300;
        gate.setMode('background');
        gate.markDrawn(1000);
        expect(gate.shouldDraw(1299)).toBe(false);
        expect(gate.shouldDraw(1300)).toBe(true);
    });

    test('markDrawn advances the counter', () => {
        gate.markDrawn(5);
        gate.markDrawn(25);
        expect(gate.drawn).toBe(2);
    });

    test('disabled never draws and re-enabling draws immediately', () => {
        gate.markDrawn(0);
        gate.setEnabled(false);
        expect(gate.shouldDraw(10_000)).toBe(false);
        gate.setEnabled(true);
        expect(gate.shouldDraw(10_000)).toBe(true);
    });
});

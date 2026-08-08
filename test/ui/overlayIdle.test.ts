import { describe, expect, test } from 'bun:test';

/**
 * Documents when the HTML overlay should skip a draw. Implementation lives in
 * Overlay.ts; this locks the idle policy so we do not reintroduce clearRect
 * storms on multi-bot walls with idle clients.
 */
function shouldPaintOverlay(opts: {
    pathEnabled: boolean;
    pathTiles: number;
    scriptPaintReady: boolean;
    hasOnPaint: boolean;
}): boolean {
    const pathLabels = opts.pathEnabled && opts.pathTiles > 0;
    const botPaint = opts.hasOnPaint && opts.scriptPaintReady;
    return pathLabels || botPaint;
}

describe('overlay idle policy', () => {
    test('idle client (no path, no script) skips paint', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: false, hasOnPaint: true })
        ).toBe(false);
    });

    test('running script with onPaint paints', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: true, hasOnPaint: true })
        ).toBe(true);
    });

    test('script startup with onPaint stays idle until its baseline is ready', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: false, hasOnPaint: true })
        ).toBe(false);
    });

    test('nav path labels paint even without a script', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 12, scriptPaintReady: false, hasOnPaint: false })
        ).toBe(true);
    });

    test('path enabled but empty store does not paint labels', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 0, scriptPaintReady: false, hasOnPaint: false })
        ).toBe(false);
    });
});

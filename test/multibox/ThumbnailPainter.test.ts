import { describe, expect, test } from 'bun:test';
import { paintThumbnail } from '#/bot/multibox/ThumbnailPainter.js';

interface FakeCanvas {
    name: string;
    width: number;
    height: number;
}

function canvas(name: string, width = 765, height = 503): HTMLCanvasElement {
    return { name, width, height } as unknown as HTMLCanvasElement;
}

function context(calls: string[]): Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'> {
    return {
        clearRect: () => calls.push('clear'),
        drawImage: (source: CanvasImageSource) => calls.push((source as unknown as FakeCanvas).name)
    } as Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'>;
}

describe('paintThumbnail', () => {
    test('composites the transparent paint canvas over the game canvas', () => {
        const calls: string[] = [];
        expect(paintThumbnail(context(calls), canvas('game'), canvas('overlay'), 236, 155)).toBe(true);
        expect(calls).toEqual(['clear', 'game', 'overlay']);
    });

    test('still paints the game when no overlay is available', () => {
        const calls: string[] = [];
        expect(paintThumbnail(context(calls), canvas('game'), null, 236, 155)).toBe(true);
        expect(calls).toEqual(['clear', 'game']);
    });

    test('does nothing until the game canvas has dimensions', () => {
        const calls: string[] = [];
        expect(paintThumbnail(context(calls), canvas('game', 0, 0), canvas('overlay'), 236, 155)).toBe(false);
        expect(calls).toEqual([]);
    });
});

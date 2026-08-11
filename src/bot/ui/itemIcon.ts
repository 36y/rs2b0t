import { reader } from '../adapter/ClientAdapter.js';

/**
 * Item icon as a data URL. Null when the cache is not loaded or the id has no
 * sprite, so callers fall back to the item's name.
 *
 * The adapter hands over raw pixels rather than a canvas: DOM is fenced to this
 * directory, and the client stores icons as an `Int32Array` of 0xRRGGBB with 0
 * meaning transparent.
 */
export function itemIconDataUrl(id: number): string | null {
    const sprite = reader.itemIconPixels(id);
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    const image = ctx.createImageData(sprite.width, sprite.height);
    for (let i = 0; i < sprite.data.length; i++) {
        const rgb = sprite.data[i]!;
        image.data[i * 4] = (rgb >> 16) & 0xff;
        image.data[i * 4 + 1] = (rgb >> 8) & 0xff;
        image.data[i * 4 + 2] = rgb & 0xff;
        image.data[i * 4 + 3] = rgb === 0 ? 0 : 0xff;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

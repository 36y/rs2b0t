type ThumbnailContext = Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'>;

/** Paint the game and transparent bot-overlay canvases into one rail thumbnail. */
export function paintThumbnail(ctx: ThumbnailContext, game: HTMLCanvasElement | null, overlay: HTMLCanvasElement | null, width: number, height: number): boolean {
    if (!game || game.width <= 0 || game.height <= 0) {
        return false;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(game, 0, 0, game.width, game.height, 0, 0, width, height);
    if (overlay && overlay.width > 0 && overlay.height > 0) {
        ctx.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, width, height);
    }
    return true;
}

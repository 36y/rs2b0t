// docs/decisions/architecture.md#per-instance-storage
// Why: every bot instance keeps its credentials and settings under a "box" id so nothing bleeds between instances.
// Why: a standalone bot.html tab is box '', isolated by its own sessionStorage.
// Why: a MultiBox iframe is box '<account>', isolated within the tab's shared sessionStorage, because same-origin iframes share one sessionStorage.
// Why: the MultiBox passes ?box=<account> when it spawns each iframe.
export function boxId(): string {
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

export function boxKey(suffix: string): string {
    const id = boxId();
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

// Why: one build serves /rs2b0t/index.html and local dev's /bot.html, and a relative path resolves to a file beside either.
// Why: './wall' would only work under the hosted Caddy rewrite.
export function wallLinkHref(box: string): string | null {
    return box === '' ? './multibox.html' : null;
}

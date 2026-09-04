export interface ImageFallbackState {
    get src(): string;
    get failed(): boolean;
    onError(): void;
}
export function useImageFallback(options: {
    urls: () => readonly string[];
    key: () => string;
}): ImageFallbackState {
    let attempt = $state(0);
    let lastKey = '';
    $effect(() => {
        const current = options.key();
        if (current !== lastKey) {
            lastKey = current;
            attempt = 0;
        }
    });
    const urls = $derived(options.urls());
    return {
        get src() {
            return urls[attempt] ?? '';
        },
        get failed() {
            return attempt >= urls.length;
        },
        onError() {
            if (attempt < urls.length - 1) {
                attempt += 1;
                return;
            }
            attempt = urls.length;
        },
    };
}

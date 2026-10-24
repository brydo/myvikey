export const eventTypes = ['celebration', 'events', 'weddings', 'parties', 'engagements'];

export function theme(type) {
    return eventTypes.includes(type) ? type : 'celebration';
}

export const defaultBackgrounds = {
    celebration: '',
    events: 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/ween.jpg',
    weddings: '',
    parties: '',
    engagements: ''
};

export function safeBackground(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    if (value === '') return true;
    // Restrict CSS delimiters too, even though clients set only a CSS property.
    if (!/^https:\/\//i.test(value) || /[\s"'()\\<>;{}\u0000-\u001f\u007f]/.test(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
    } catch {
        return false;
    }
}

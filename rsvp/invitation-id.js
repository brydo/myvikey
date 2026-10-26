// Encode every UUID bit; no lookup table, truncation or migration is needed.
const invitationAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function validInvitationId(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function invitationShortId(id) {
    if (!validInvitationId(id)) return null;
    const hex = id.replace(/-/g, '');
    let bits = 0, value = 0, code = '';
    for (let i = 0; i < hex.length; i += 2) {
        value = (value << 8) | parseInt(hex.slice(i, i + 2), 16);
        bits += 8;
        while (bits >= 6) {
            bits -= 6;
            code += invitationAlphabet[(value >>> bits) & 63];
        }
    }
    return code + invitationAlphabet[(value << 4) & 63];
}

export function invitationId(value) {
    if (validInvitationId(value)) return value;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
    let bits = 0, buffer = 0, hex = '';
    for (const character of value) {
        buffer = (buffer << 6) | invitationAlphabet.indexOf(character);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            hex += ((buffer >>> bits) & 255).toString(16).padStart(2, '0');
        }
    }
    const id = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
        '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    return invitationShortId(id) === value ? id : null;
}

export function invitationPath(value) {
    const id = invitationId(value);
    return id ? '/rsvp/i/' + invitationShortId(id) : '/rsvp/';
}

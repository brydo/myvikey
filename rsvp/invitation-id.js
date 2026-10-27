const invitationAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function validInvitationId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{7}$/.test(value);
}

export function generateInvitationId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(7)),
        value => invitationAlphabet[value & 63]).join('');
}

export function invitationId(value) {
    return validInvitationId(value) ? value : null;
}

export function invitationPath(value) {
    const id = invitationId(value);
    return id ? '/rsvp/i/' + id : '/rsvp/';
}

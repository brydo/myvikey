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

export const copyFields = {
    brand: { label: 'Brand', max: 100, default: 'V I Key® · RSVP' },
    tagline: { label: 'Tagline', max: 100, default: 'Together is a beautiful place to be' },
    inviteHeading: { label: 'Invitation heading', max: 100, default: "You're invited.", required: true },
    inviteText: { label: 'Default invitation', max: 1000, default: 'Make room for a little celebration.\n\nA beautiful invitation, a special gathering, and the people who make it yours.' },
    inviteHelp: { label: 'Invitation help', max: 1000, default: 'Have an invitation? Open the unique event link shared by your host to view the details and send your RSVP.' },
    openRsvp: { label: 'Open RSVP button', max: 100, default: 'RSVP to this celebration', required: true },
    replyHeading: { label: 'Reply heading', max: 100, default: 'Your reply', required: true },
    nameLabel: { label: 'Name label', max: 100, default: 'Name', required: true },
    eventLabel: { label: 'Event label', max: 100, default: 'Event', required: true },
    attendingLabel: { label: 'Attending label', max: 100, default: 'Attending', required: true },
    chooseLabel: { label: 'Choose label', max: 100, default: 'Please choose', required: true },
    yesLabel: { label: 'Yes label', max: 100, default: 'Yes', required: true },
    noLabel: { label: 'No label', max: 100, default: 'No', required: true },
    guestsLabel: { label: 'Guests label', max: 100, default: 'Guests', required: true },
    guestsHint: { label: 'Guests hint', max: 1000, default: 'Additional guests, not including you. Use 0 if not attending.' },
    notesLabel: { label: 'Notes label', max: 100, default: 'Notes (optional)', required: true },
    receiptNotesLabel: { label: 'Receipt notes label', max: 100, default: 'Notes', required: true },
    saveReply: { label: 'Save reply button', max: 100, default: 'Save RSVP & choose how to send', required: true },
    saveHelp: { label: 'Save help', max: 1000, default: 'Your reply will be saved here. You can then open WhatsApp or text/SMS to send it to your host yourself.' },
    receiptHeading: { label: 'Receipt heading', max: 100, default: 'Thank you!', required: true },
    receiptEmptyHeading: { label: 'Empty receipt heading', max: 100, default: 'Your RSVP', required: true },
    receiptMessage: { label: 'Receipt message', max: 1000, default: 'Thanks, your RSVP is saved on this site.' },
    receiptEmpty: { label: 'Empty receipt message', max: 1000, default: 'No RSVP to display in this tab. Send a response to see your confirmation here.' },
    backLink: { label: 'Back link', max: 100, default: 'Back to RSVP', required: true },
    cardHeading: { label: 'Reply card heading', max: 100, default: 'RSVP', required: true },
    whatsappLabel: { label: 'WhatsApp button', max: 100, default: 'Send via WhatsApp', required: true },
    smsLabel: { label: 'Text/SMS button', max: 100, default: 'Send via text/SMS', required: true },
    sendHelp: { label: 'Send help', max: 1000, default: 'Your RSVP is saved on this site. Choose an app below, then send the message yourself. Nothing has been sent to your host automatically.' },
    noChannelsHelp: { label: 'No channels help', max: 1000, default: 'Your RSVP is saved on this site. Your host has no valid WhatsApp or text/SMS number configured; no external message has been sent.' },
    smsUnavailable: { label: 'Text/SMS unavailable', max: 1000, default: 'Text/SMS is unavailable because your host has not configured a valid text/SMS number.' },
    savedMessage: { label: 'Saved message', max: 1000, default: 'Thanks, your RSVP is saved. No external message has been sent.' },
    landingTagline: { label: 'Landing tagline', max: 100, default: '' },
    landingHeading: { label: 'Landing heading', max: 100, default: 'Bring everyone together.', required: true },
    landingDescription: { label: 'Landing description', max: 1000, default: '' },
    landingExtra: { label: 'Landing extra paragraph', max: 1000, default: '' },
    landingHelp: { label: 'Landing help', max: 1000, default: '' },
    previewLabel: { label: 'Preview label', max: 100, default: 'A little inspiration · example invitation' },
    sampleBrand: { label: 'Sample brand', max: 100, default: '' },
    sampleHeading: { label: 'Sample heading', max: 100, default: 'A night to remember', required: true },
    sampleSubtitle: { label: 'Sample subtitle', max: 100, default: '' },
    sampleDate: { label: 'Sample date', max: 100, default: '' },
    sampleVenue: { label: 'Sample venue', max: 1000, default: '' },
    sampleMessage: { label: 'Sample message', max: 1000, default: '' },
    detailsHeading: { label: 'Details heading', max: 100, default: 'Your event, beautifully connected.', required: true },
    step1Heading: { label: 'Step 1 heading', max: 100, default: 'Make it yours', required: true },
    step1Text: { label: 'Step 1 text', max: 1000, default: '' },
    step2Heading: { label: 'Step 2 heading', max: 100, default: 'Share your moment', required: true },
    step2Text: { label: 'Step 2 text', max: 1000, default: '' },
    step3Heading: { label: 'Step 3 heading', max: 100, default: 'Welcome your guests', required: true },
    step3Text: { label: 'Step 3 text', max: 1000, default: '' },
    footerHelp: { label: 'Footer help', max: 1000, default: '' },
    exploreLink: { label: 'Explore link', max: 100, default: 'Explore all celebrations', required: true },
    homeLink: { label: 'Home link', max: 100, default: 'V I Key® home', required: true },
    occasionHeading: { label: 'Occasion heading', max: 100, default: 'Every occasion, beautifully yours.', required: true },
    occasionDescription: { label: 'Occasion description', max: 1000, default: 'Explore a theme for your next celebration.' }
};

for (const field of Object.values(copyFields)) field.required = field.required === true;

const categoryCopy = {
    celebration: {},
    events: {
        tagline: 'Made for your moment · made to share',
        landingTagline: 'Made for your moment · made to share',
        landingHeading: 'Bring everyone together.',
        landingDescription: 'A special gathering, your own atmosphere, and the people who make it yours.',
        landingHelp: 'Already invited? Open the unique event link shared by your host to view the details and RSVP.',
        sampleBrand: "You're invited",
        sampleHeading: 'A night to remember',
        sampleSubtitle: 'Good company and a little celebration',
        sampleVenue: "Your host's personal invitation link has the date, venue and RSVP details.",
        detailsHeading: 'Your event, beautifully connected.',
        step1Heading: 'Make it yours',
        step1Text: 'Your site admin adds the invitation details and chooses the shared category background.',
        step2Heading: 'Share your moment',
        step2Text: 'Each saved invitation has its own unique link.',
        step3Heading: 'Welcome your guests',
        step3Text: 'Guests reply online. Each reply stays linked to its invitation.'
    },
    weddings: {
        tagline: 'A beautiful beginning, shared with our favourite people',
        landingTagline: 'Botanical romance · sage & ivory',
        landingHeading: 'Your forever starts with a beautiful invitation.',
        landingDescription: 'Soft botanical greens, warm ivory and golden wedding bands. A little glimpse of your love story, made to share with everyone who matters.',
        landingExtra: 'Bring your ceremony, reception and RSVP details together in one heartfelt invitation.',
        landingHelp: 'Already invited? Open the unique wedding link shared by your host to view the details and RSVP.',
        sampleBrand: 'Together with their families',
        sampleHeading: 'Alex & Jamie',
        sampleSubtitle: 'Joyfully invite you to their wedding',
        sampleDate: 'Saturday, 19 June 2027 · 2 pm',
        sampleVenue: 'The Rose Garden\nDinner, dancing & happily ever after',
        sampleMessage: 'Your presence would mean the world to us.\nPlease reply by 19 May.',
        detailsHeading: 'Less organising. More happily ever after.',
        step1Heading: 'Make it yours',
        step1Text: 'Your site admin adds your names, ceremony time, venue and reply-by date, with this wedding theme selected.',
        step2Heading: 'Share your moment',
        step2Text: 'Saving creates an automatic event ID and a unique link to send by WhatsApp or text/SMS.',
        step3Heading: 'Welcome your guests',
        step3Text: 'Guests reply online with attendance, additional guests and notes. Replies stay linked to your wedding.',
        footerHelp: 'Already invited? Open the personal event link shared by your host.'
    },
    parties: {
        tagline: 'Good company. Great memories. Let’s celebrate!',
        landingTagline: 'Colourful confetti · lilac & peach',
        landingHeading: 'Big smiles. Good vibes. Your kind of party.',
        landingDescription: 'A shower of confetti, playful colours and a whole lot of joy. Give birthdays, anniversaries and just-because gatherings an invitation as fun as the occasion.',
        landingExtra: 'Set the scene with your party time, place, dress code and anything guests should bring.',
        landingHelp: 'Already invited? Open the unique party link shared by your host to view the details and RSVP.',
        sampleBrand: "You're on the guest list",
        sampleHeading: 'Morgan turns 30!',
        sampleSubtitle: "Let's make a night of it",
        sampleDate: 'Saturday, 17 July 2027 · 7 pm',
        sampleVenue: 'The Garden Room\nWear something bright & bring your dancing shoes',
        sampleMessage: 'Good friends, favourite tunes and plenty of cake.\nPlease reply by 3 July.',
        detailsHeading: 'Less chasing replies. More celebrating.',
        step1Heading: 'Set the party mood',
        step1Text: 'Your site admin adds the occasion, time, venue and all the fun details, with this confetti theme selected.',
        step2Heading: 'Get the word out',
        step2Text: 'Saving creates an automatic event ID and a unique link to send by WhatsApp or text/SMS.',
        step3Heading: 'Count your people',
        step3Text: 'Guests reply online with attendance, additional guests and notes. Every reply belongs to your party.',
        footerHelp: 'Already invited? Open the personal event link shared by your host.'
    },
    engagements: {
        tagline: 'Here’s to forever, and the people who make it sparkle',
        landingTagline: 'Champagne & stars · blush & gold',
        landingHeading: 'A little sparkle. A lifetime of love.',
        landingDescription: 'You said yes. Now share the joy. Soft blush, champagne tones and delicate starlight make a lovely beginning to your next chapter.',
        landingExtra: 'Gather your favourite people for a toast, a story and a celebration of everything still to come.',
        landingHelp: 'Already invited? Open the unique engagement link shared by your host to view the details and RSVP.',
        sampleBrand: "We're engaged!",
        sampleHeading: 'Charlie & Sam',
        sampleSubtitle: 'Join us for a toast to forever',
        sampleDate: 'Saturday, 21 August 2027 · 6 pm',
        sampleVenue: 'The Willow Terrace\nA sparkling evening with our favourite people',
        sampleMessage: 'Come for the love, stay for the celebration.\nPlease reply by 7 August.',
        detailsHeading: 'Your next chapter, beautifully shared.',
        step1Heading: 'Tell your story',
        step1Text: 'Your site admin adds your names, celebration details and reply-by date, with this engagement theme selected.',
        step2Heading: 'Share the sparkle',
        step2Text: 'Saving creates an automatic event ID and a unique link to send by WhatsApp or text/SMS.',
        step3Heading: 'Bring everyone together',
        step3Text: 'Guests reply online with attendance, additional guests and notes. Replies stay linked to your engagement celebration.',
        footerHelp: 'Already invited? Open the personal event link shared by your host.'
    }
};

export function defaultCopy(type) {
    return { ...Object.fromEntries(Object.entries(copyFields).map(([key, field]) => [key, field.default])),
        ...categoryCopy[theme(type)] };
}

export const styleFields = {
    surface: { label: 'Card surface', min: null, max: null, step: null, type: 'color' },
    textColor: { label: 'Text colour', min: null, max: null, step: null, type: 'color' },
    headingColor: { label: 'Heading colour', min: null, max: null, step: null, type: 'color' },
    bodyScale: { label: 'Body text size', min: 1, max: 1.4, step: 0.05, type: 'number' },
    headingScale: { label: 'Heading size', min: 0.8, max: 1.5, step: 0.05, type: 'number' },
    lineHeight: { label: 'Line height', min: 1.4, max: 2.2, step: 0.1, type: 'number' },
    alignment: { label: 'Alignment', min: null, max: null, step: null, type: 'select' },
    spacing: { label: 'Section spacing', min: 12, max: 32, step: 1, type: 'number' }
};

export function defaultCardStyle(type) {
    const [surface, textColor] = {
        celebration: ['#fffaf4', '#493439'],
        events: ['#faffff', '#2e4650'],
        weddings: ['#fffdf7', '#34463a'],
        parties: ['#fffaff', '#422751'],
        engagements: ['#fffcf8', '#563b35']
    }[theme(type)];
    return { surface, textColor, headingColor: textColor, bodyScale: 1, headingScale: 1,
        lineHeight: 1.6, alignment: 'center', spacing: 24 };
}

const appearanceObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function copyValue(key, value) {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
    if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(normalized)) return null;
    const text = normalized.trim();
    return text.length <= copyFields[key].max && (!copyFields[key].required || text.length > 0) ? text : null;
}

function styleValue(key, value) {
    const field = styleFields[key];
    if (field.type === 'color') {
        if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
        const hex = value.slice(1).toLowerCase();
        return '#' + (hex.length === 3 ? [...hex].map(char => char + char).join('') : hex);
    }
    if (field.type === 'select') return ['center', 'left'].includes(value) ? value : null;
    return typeof value === 'number' && Number.isFinite(value) ?
        Math.min(field.max, Math.max(field.min, value)) : null;
}

function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(first, second) {
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function normalizeAppearance(type, value) {
    type = theme(type);
    value = appearanceObject(value) ? value : {};
    const copy = defaultCopy(type);
    const cardStyle = defaultCardStyle(type);
    if (appearanceObject(value.copy)) {
        for (const key of Object.keys(copyFields)) {
            if (!own(value.copy, key)) continue;
            const text = copyValue(key, value.copy[key]);
            if (text !== null) copy[key] = text;
        }
    }
    if (appearanceObject(value.cardStyle)) {
        for (const key of Object.keys(styleFields)) {
            if (!own(value.cardStyle, key)) continue;
            const setting = styleValue(key, value.cardStyle[key]);
            if (setting !== null) cardStyle[key] = setting;
        }
    }
    for (const key of ['textColor', 'headingColor']) {
        if (contrast(cardStyle[key], cardStyle.surface) >= 4.5) continue;
        const fallback = defaultCardStyle(type)[key];
        // A valid dark surface may also need a lighter fallback than the category ink.
        cardStyle[key] = contrast(fallback, cardStyle.surface) >= 4.5 ? fallback :
            contrast('#000000', cardStyle.surface) >= 4.5 ? '#000000' : '#ffffff';
    }
    return {
        backgroundImage: own(value, 'backgroundImage') && safeBackground(value.backgroundImage) ?
            value.backgroundImage : defaultBackgrounds[type],
        copy, cardStyle
    };
}

export function validateAppearance(type, value) {
    if (!appearanceObject(value) || Object.keys(value).some(key => !['backgroundImage', 'copy', 'cardStyle'].includes(key)) ||
        !own(value, 'backgroundImage') || !safeBackground(value.backgroundImage)) return null;
    for (const [group, fields, validate] of [
        ['copy', copyFields, copyValue], ['cardStyle', styleFields, styleValue]
    ]) {
        if (!own(value, group)) continue;
        if (!appearanceObject(value[group]) ||
            Object.keys(value[group]).some(key => !own(fields, key) || validate(key, value[group][key]) === null)) return null;
    }
    const suppliedStyle = { ...defaultCardStyle(type), ...value.cardStyle };
    for (const key of Object.keys(suppliedStyle)) suppliedStyle[key] = styleValue(key, suppliedStyle[key]);
    if (['textColor', 'headingColor'].some(key => contrast(suppliedStyle[key], suppliedStyle.surface) < 4.5)) return null;
    return normalizeAppearance(type, value);
}

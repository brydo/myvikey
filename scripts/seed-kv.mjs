// Seeds sample pet and memorial data into Cloudflare Workers KV.
// Usage: see scripts/README.md
import bcrypt from 'bcryptjs';

const {
  CF_ACCOUNT_ID, CF_API_TOKEN,
  PET_CONTENT_ID, MEMORIAL_CONTENT_ID, PET_PASSWORDS_ID, MEMORIAL_PASSWORDS_ID,
  CARD_CONTENT_ID
} = process.env;
const PASSWORD = process.env.SEED_PASSWORD || 'password123';
const DRY_RUN = process.argv.includes('--dry-run');

const PLACEHOLDER_PHOTO = 'https://placehold.co/600x600?text=';
const fmt = (iso) => new Date(iso + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function entry(id, name, photo, story, born, passed, audio = '') {
  return {
    id,
    content: {
      name,
      photoUrl: photo,
      text: story,
      born,
      passed,
      dob: `${fmt(born)} – ${fmt(passed)}`, // string shown by the viewer pages
      audioUrl: audio,
      photoPosition: '50% 50%',
      updated: new Date().toISOString()
    }
  };
}

const pets = [
  entry('charlie', 'Charlie', PLACEHOLDER_PHOTO + 'Charlie',
    'Charlie was a loyal companion who greeted every day with a wagging tail and never left our side.',
    '2008-04-12', '2022-09-03'),
  entry('robbie', 'Robbie', PLACEHOLDER_PHOTO + 'Robbie',
    'Robbie was a beloved friend whose gentle nature and playful spirit brought joy to everyone he met.',
    '2010-06-20', '2023-11-15')
];
const memorials = [
  entry('margaret', 'Margaret', PLACEHOLDER_PHOTO + 'Margaret',
    'Margaret was a loving mother and grandmother, remembered for her warmth, her baking and her kindness.',
    '1941-03-08', '2021-12-19'),
  entry('james', 'James', PLACEHOLDER_PHOTO + 'James',
    'James was a devoted husband and friend, remembered for his humour, generosity and love of the outdoors.',
    '1938-08-25', '2020-05-30')
];

// Sample MyCard data (V I Key business details) - change via /mycard/admin
const cards = [
  {
    id: 'demo',
    content: {
      name: 'Sample Card (edit me)',
      title: 'Owner',
      company: 'V I Key®',
      bio: 'This is SAMPLE data for the MyCard demo. The owner can change every field in the MyCard admin page.',
      photoUrl: PLACEHOLDER_PHOTO + 'V+I+Key',
      photoPosition: '50% 50%',
      phone: '',
      whatsapp: 'https://wa.me/qr/S3WV63OUV4CTP1',
      email: 'vikeyshop@outlook.com',
      website: 'https://vi-key.uk/',
      mapUrl: '',
      facebook: 'https://www.facebook.com/vi.key.page',
      instagram: 'https://www.instagram.com/vi_key_shop',
      tiktok: 'https://www.tiktok.com/@vi_keyshop',
      linkedin: '', twitter: '', youtube: '', telegram: '',
      customLabel: '', customUrl: '',
      accentColor: '#c9a96e',
      updated: new Date().toISOString()
    }
  }
];

async function bulkWrite(namespaceId, items) {
  if (DRY_RUN) { console.log(namespaceId || '(dry-run)', JSON.stringify(items.map(i => i.key))); return; }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/bulk`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(items)
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(`KV write failed: ${JSON.stringify(data.errors || data)}`);
  console.log(`Wrote ${items.length} keys to ${namespaceId}`);
}

async function main() {
  if (!DRY_RUN) {
    const required = { CF_ACCOUNT_ID, CF_API_TOKEN, PET_CONTENT_ID, MEMORIAL_CONTENT_ID, PET_PASSWORDS_ID, MEMORIAL_PASSWORDS_ID, CARD_CONTENT_ID };
    const missing = Object.keys(required).filter(k => !required[k]);
    if (missing.length) throw new Error('Missing environment variables: ' + missing.join(', '));
  }
  const toContent = (list) => list.map(e => ({ key: e.id, value: JSON.stringify(e.content) }));
  const toPasswords = async (list) => Promise.all(list.map(async e => ({
    key: e.id, value: await bcrypt.hash(PASSWORD, 12)
  })));

  await bulkWrite(PET_CONTENT_ID, toContent(pets));
  await bulkWrite(MEMORIAL_CONTENT_ID, toContent(memorials));
  await bulkWrite(CARD_CONTENT_ID, toContent(cards));
  await bulkWrite(PET_PASSWORDS_ID, await toPasswords(pets));
  await bulkWrite(MEMORIAL_PASSWORDS_ID, await toPasswords(memorials));
  console.log(`Done. Sample password: ${PASSWORD}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

// events/wrAutoSync.js
// Dunya rekorlarini elle /wr sync beklemeden guncel tutar:
//  • acilistan 1 dk sonra ve 6 saatte bir WR kanal(lar)ini tarar (AI yok, parser)
//  • 5 dk'da bir kayitli rekorlari Mad+ lobby'sine yollar (lobby bellekte tutuyor,
//    deploy olunca bosaliyor)
// Kanallar: WR_CHANNEL_IDS env (virgullu). Varsayilan: M25'in WR kanali.

const { syncWorldRecords } = require('../services/worldRecords');
const { pushRecords }      = require('../services/recordsSync');

const CHANNELS = String(process.env.WR_CHANNEL_IDS || '1264613579588374598')
    .split(',').map(s => s.trim()).filter(Boolean);

const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const PUSH_EVERY_MS = 5 * 60 * 1000;

async function syncAll(client) {
    for (const id of CHANNELS) {
        try {
            const channel = await client.channels.fetch(id).catch(() => null);
            if (!channel?.messages) {
                console.warn(`[WR SYNC] can't read channel ${id} — is Chamy in that server?`);
                continue;
            }
            const r = await syncWorldRecords(channel);
            console.log(`[WR SYNC] #${channel.name}: ${r.tracks} tracks, ${r.records} records${r.unmatched.length ? ` (not in Mad+: ${r.unmatched.join(', ')})` : ''}`);
        } catch (err) {
            console.error(`[WR SYNC] ${id} failed:`, err.message);
        }
    }
    await pushRecords().catch(err => console.error('[WR PUSH] failed:', err.message));
}

module.exports = (client) => {
    const start = () => {
        setTimeout(() => syncAll(client), 60 * 1000).unref?.();
        setInterval(() => syncAll(client), SYNC_EVERY_MS).unref?.();
        setInterval(() => {
            pushRecords().catch(err => console.error('[WR PUSH] failed:', err.message));
        }, PUSH_EVERY_MS).unref?.();
    };
    if (client.isReady?.()) start();
    else client.once('ready', start);
};

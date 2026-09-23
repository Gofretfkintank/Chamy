// events/ratingSync.js
// 20 dakikada bir SIRADAKI Madcar sunucusunun sonuc kanallarini okur
// (tick basina tek sunucu, en fazla 12 mesaj -- Gemma free tier), yeni sonuc
// geldiyse rating'i bastan hesaplar.

const { ingestGuild, recomputeAll } = require('../services/rating/ingest');

const TICK_MS = 20 * 60 * 1000;
const lastScan = new Map(); // guildId -> ms
let running = false;

async function tick(client) {
    if (running || !process.env.GEMINI_API_KEY) return;
    running = true;
    try {
        const next = [...client.guilds.cache.values()]
            .sort((a, b) => (lastScan.get(a.id) || 0) - (lastScan.get(b.id) || 0))[0];
        if (!next) return;
        lastScan.set(next.id, Date.now());

        const r = await ingestGuild(next);
        if (r.scanned) console.log(`[RATING] ${next.name}: ${r.scanned} checked, ${r.added} race results`);
        if (r.added) {
            const c = await recomputeAll();
            console.log(`[RATING] recomputed: ${c.players} drivers from ${c.races} races`);
        }
    } catch (err) {
        console.error('[RATING] tick failed:', err.message);
    } finally {
        running = false;
    }
}

module.exports = (client) => {
    const start = () => {
        setTimeout(() => tick(client), 5 * 60 * 1000).unref?.();
        setInterval(() => tick(client), TICK_MS).unref?.();
    };
    if (client.isReady?.()) start();
    else client.once('ready', start);
};

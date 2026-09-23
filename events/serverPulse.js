// events/serverPulse.js
// ─────────────────────────────────────────────────────────────────────────────
// Chamy'nin sunucuları "dinlediği" yer — AI yok, sadece sayaç.
//
// • Her mesajda: sunucunun saat (UTC) / gün histogramı, kişi başı mesaj sayısı,
//   yarış kanallarındaki mesajlar ve "lobby / oda kodu / hostluyorum" tarzı
//   host sinyalleri. Bellekte biriktirip 5 dakikada bir Mongo'ya toplu yazar.
// • 30 dakikada bir: profili 12 saatten eski olan BİR sunucunun profilini
//   services/serverProfile ile yeniler (tick başına tek sunucu — maliyet).
//
// Sadece Chamy'nin uyandırıldığı sunucularda çalışır (ommy:enabled = "1").
// Commander'ın açmadığı bir sunucuda üyelerin aktivitesini saymıyoruz.
// ─────────────────────────────────────────────────────────────────────────────

const cfg            = require('../lib/guildConfig');
const ServerActivity = require('../models/ServerActivity');
const ServerProfile  = require('../models/ServerProfile');
const { refreshServerProfile, currentWeek, WEEK_MS } = require('../services/serverProfile');

const FLUSH_MS         = 5 * 60 * 1000;
const TICK_MS          = 30 * 60 * 1000;
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

const RACE_CHANNEL_RE = /(race|yar[ıi][şs]|lobby|lobi|session|event|etkinlik|host|grid|round|quali|s[ıi]ralama)/i;
const HOST_RE = /(lobby|lobi\b|lobiyi|room\s*code|oda\s*(kodu|[şs]ifre|ismi|ad[ıi])|oda\s*a[çc]|[şs]ifre\s*:|password\s*:|pass\s*:|\bhost(ing|luyorum|layaca[gğ][ıi]m|l[ıi]yorum)?\b)/i;

const userBuf  = new Map(); // `${guildId}|${week}|${userId}` -> { name, count, raceTalk, hostSignals, lastAt }
const guildBuf = new Map(); // `${guildId}|${week}`          -> { hours: {}, days: {} }

async function record(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    if ((await cfg.get(message.guild.id, 'ommy:enabled')) !== '1') return;

    const now  = message.createdTimestamp || Date.now();
    const d    = new Date(now);
    const gKey = `${message.guild.id}|${currentWeek(now)}`;

    const g = guildBuf.get(gKey) || { hours: {}, days: {} };
    const h = d.getUTCHours();
    const w = d.getUTCDay();
    g.hours[h] = (g.hours[h] || 0) + 1;
    g.days[w]  = (g.days[w]  || 0) + 1;
    guildBuf.set(gKey, g);

    const uKey = `${gKey}|${message.author.id}`;
    const u = userBuf.get(uKey) || { name: '', count: 0, raceTalk: 0, hostSignals: 0, lastAt: null };
    u.name = message.member?.displayName || message.author.globalName || message.author.username;
    u.count++;
    const where = `${message.channel?.parent?.name || ''} ${message.channel?.name || ''}`;
    if (RACE_CHANNEL_RE.test(where)) u.raceTalk++;
    if (HOST_RE.test(message.content || '')) u.hostSignals++;
    u.lastAt = d;
    userBuf.set(uKey, u);
}

async function flush() {
    if (userBuf.size === 0 && guildBuf.size === 0) return;
    const users  = [...userBuf.entries()];
    const guilds = [...guildBuf.entries()];
    userBuf.clear();
    guildBuf.clear();

    const expiresAt = new Date(Date.now() + 9 * WEEK_MS);
    const ops = [];

    for (const [key, v] of users) {
        const [guildId, week, userId] = key.split('|');
        ops.push({ updateOne: {
            filter: { guildId, week: Number(week), userId },
            update: {
                $inc: { count: v.count, raceTalk: v.raceTalk, hostSignals: v.hostSignals },
                $set: { name: v.name, lastAt: v.lastAt, expiresAt },
            },
            upsert: true,
        } });
    }

    for (const [key, v] of guilds) {
        const [guildId, week] = key.split('|');
        const inc = {};
        let total = 0;
        for (const [hour, n] of Object.entries(v.hours)) { inc[`hours.${hour}`] = n; total += n; }
        for (const [day, n]  of Object.entries(v.days))  { inc[`days.${day}`]   = n; }
        inc.count = total;
        ops.push({ updateOne: {
            filter: { guildId, week: Number(week), userId: '__guild__' },
            update: { $inc: inc, $set: { expiresAt } },
            upsert: true,
        } });
    }

    try {
        // Ham koleksiyon: hours.13 gibi dinamik path'ler mongoose cast'ine takılmasın.
        await ServerActivity.collection.bulkWrite(ops, { ordered: false });
    } catch (err) {
        console.error('[PULSE] flush failed:', err.message);
    }
}

let ticking = false;
async function refreshTick(client) {
    if (ticking || !process.env.GEMINI_API_KEY) return;
    ticking = true;
    try {
        await flush();
        for (const [, guild] of client.guilds.cache) {
            if ((await cfg.get(guild.id, 'ommy:enabled')) !== '1') continue;
            const p = await ServerProfile.findOne({ guildId: guild.id }, { refreshedAt: 1 }).lean().catch(() => null);
            if (p?.refreshedAt && Date.now() - new Date(p.refreshedAt).getTime() < REFRESH_EVERY_MS) continue;

            const r = await refreshServerProfile(guild);
            console.log(`[PULSE] profile ${guild.name}:`, r.error || `${r.events} events, ${r.hosts} hosts, ${r.standings} standings${r.warning ? ` (warning: ${r.warning})` : ''}`);
            break; // tick başına tek sunucu
        }
    } catch (err) {
        console.error('[PULSE] refresh tick failed:', err.message);
    } finally {
        ticking = false;
    }
}

module.exports = (client) => {
    client.on('messageCreate', (message) => {
        record(message).catch(() => {});
    });

    const flushTimer = setInterval(() => { flush(); }, FLUSH_MS);
    flushTimer.unref?.();

    const start = () => {
        setTimeout(() => refreshTick(client), 2 * 60 * 1000).unref?.();
        setInterval(() => refreshTick(client), TICK_MS).unref?.();
    };
    if (client.isReady?.()) start();
    else client.once('ready', start);
};

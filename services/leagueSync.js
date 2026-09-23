// services/leagueSync.js
// ─────────────────────────────────────────────────────────────────────────────
// Chamy'nin öğrendiği sunucu profillerini Mad+ lobby sunucusuna yollar →
// uygulamadaki More > Leagues sayfası. AI yok, tek bir HTTP isteği.
//
// Her seferinde TÜM liste gider (POST /v1/leagues/sync). Böylece Chamy'nin
// uyutulduğu ya da bot'un çıktığı sunucu bir sonraki sync'te listeden düşer,
// lobby yeniden başlarsa da en geç 30 dk'da tekrar dolar.
//
// Sadece herkese açık olabilecek alanlar gider: sunucu adı/ikonu, üye sayısı,
// owner adı, yarış düzeni, ligler, takvim, puan tablosu, host'lar, yoğun
// gün/saat. Aktif üye listesi ve staff listesi GİTMEZ — o bilgi sadece
// Chamy'nin o sunucunun içinde verdiği cevaplar için.
//
// Env: MADPLUS_LOBBY_URL        (https://madplus-lobby-production.up.railway.app)
//      MADPLUS_LEAGUE_SYNC_KEY  (lobby servisindeki ile aynı değer)
// ─────────────────────────────────────────────────────────────────────────────

const cfg           = require('../lib/guildConfig');
const ServerProfile = require('../models/ServerProfile');

const WARN_EVERY_MS = 6 * 60 * 60 * 1000;
let lastWarnAt = 0;

function ms(d) {
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
}

function lobbyBase() {
    return (process.env.MADPLUS_LOBBY_URL || '')
        .trim()
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
        .replace(/\/+$/, '');
}

function snapshot(p, guild) {
    const now = Date.now();
    return {
        guildId:     p.guildId,
        name:        guild?.name || p.guildName || '',
        iconUrl:     guild?.iconURL?.({ extension: 'png', size: 128 }) || null,
        memberCount: guild?.memberCount || p.memberCount || 0,
        ownerName:   p.ownerName || null,
        timezone:    p.timezone || null,
        inviteUrl:   guild?.vanityURLCode ? `https://discord.gg/${guild.vanityURLCode}` : null,
        raceSchedule: {
            summary: p.raceSchedule?.summary || '',
            days:    p.raceSchedule?.days  || [],
            times:   p.raceSchedule?.times || [],
        },
        leagues: (p.leagues || []).map(l => ({ name: l.name, format: l.format, status: l.status })),
        hosts:   (p.hosts   || []).map(h => ({ name: h.name, detail: h.detail })),
        calendar: (p.calendar || [])
            .filter(e => !e.startsAt || new Date(e.startsAt).getTime() > now - 3 * 60 * 60 * 1000)
            .slice(0, 15)
            .map(e => ({
                title:    e.title || '',
                series:   e.series || '',
                track:    e.track || '',
                host:     e.host || '',
                startsAt: ms(e.startsAt),
                timeText: e.timeText || null,
            })),
        standings: (p.standings || []).map(s => ({
            series: s.series || '',
            asOf:   ms(s.asOf),
            rows:   (s.rows || []).map(r => ({
                position: r.position ?? null,
                name:     r.name || '',
                team:     r.team || '',
                points:   r.points ?? null,
            })),
        })),
        busiestDays:  p.busiestDays  || [],
        peakHoursUtc: p.peakHoursUtc || [],
        updatedAt:    ms(p.refreshedAt),
    };
}

async function pushAll(client) {
    const base = lobbyBase();
    const key  = (process.env.MADPLUS_LEAGUE_SYNC_KEY || '').trim();
    if (!base || !key) {
        if (Date.now() - lastWarnAt > WARN_EVERY_MS) {
            lastWarnAt = Date.now();
            console.warn('[LEAGUE SYNC] MADPLUS_LOBBY_URL / MADPLUS_LEAGUE_SYNC_KEY not set — Mad+ Leagues page stays empty.');
        }
        return { skipped: true };
    }

    const profiles = await ServerProfile.find({}).lean();
    const leagues = [];
    for (const p of profiles) {
        const guild = client.guilds.cache.get(p.guildId);
        if (!guild) continue; // bot artık o sunucuda değil
        if ((await cfg.get(p.guildId, 'ommy:enabled')) !== '1') continue; // Chamy uyuyor
        leagues.push(snapshot(p, guild));
    }

    const res = await fetch(`${base}/v1/leagues/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-MadPlus-League-Key': key },
        body:    JSON.stringify({ leagues }),
        signal:  AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`lobby ${res.status}: ${text.slice(0, 200)}`);
    }
    return { pushed: leagues.length };
}

module.exports = { pushAll };

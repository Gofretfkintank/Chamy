// services/rating/madplus.js
// ───────────────────────────────────────────────────────────────────────────
// Mad+ yaris raporlari <-> rating.
//
// pullReports()  lobiden yeni raporlari ceker, RaceReport'a yazar, raporu
//                yollayanin kendi Madcar ID'sini Discord hesabina baglar.
// buildRaces()   lig sonuclari + Mad+ raporlarindan rating'e girecek yaris
//                listesini kurar:
//                  • ayni yarisi birden fazla Mad+ kullanicisi yolladiysa tek yaris
//                  • bir lig sonucuyla eslesen rapor (zaman + isim ortusmesi)
//                    -> o lig yarisi 'league_madplus' (x1.1), rapor ayrica sayilmaz
//                  • eslesmeyen rapor, bitisten 6 saat sonra 'public' yaris (x0.35)
//                    (lig sonucunu kanala atmaya zaman taniyoruz)
// pushRatings()  Discord hesabi bilinen suruculerin rating'ini lobiye yollar
//                (app profil ekrani).
// ───────────────────────────────────────────────────────────────────────────

const RaceReport   = require('../../models/RaceReport');
const MadcarLink   = require('../../models/MadcarLink');
const MadRating    = require('../../models/MadRating');
const ResultCursor = require('../../models/ResultCursor');
const engine       = require('./engine');

const CURSOR_ID        = 'lobby:race-reports';
const PUBLIC_GRACE_MS  = 6 * 60 * 60 * 1000;
const MATCH_BEFORE_MS  = 8 * 60 * 60 * 1000;  // sonuc kanala yaristan en gec 8 saat sonra
const MATCH_AFTER_MS   = 60 * 60 * 1000;
const REPORT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function lobby() {
    const base = (process.env.MADPLUS_LOBBY_URL || '').trim()
        .replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/+$/, '');
    const key = (process.env.MADPLUS_LEAGUE_SYNC_KEY || '').trim();
    return base && key ? { base, key } : null;
}

function cleanEntry(e) {
    const position = Number.isFinite(+e?.position) && +e.position > 0 ? Math.floor(+e.position) : null;
    return {
        position,
        actorNr:    Number.isFinite(+e?.actorNr) ? Math.floor(+e.actorNr) : 0,
        nick:       String(e?.nick || '').trim().slice(0, 40),
        madcarId:   /^[0-9a-f]{8,32}$/i.test(String(e?.madcarId || '')) ? String(e.madcarId).toLowerCase() : null,
        carId:      Number.isFinite(+e?.carId) ? Math.floor(+e.carId) : null,
        bestLap:    String(e?.bestLap || '').slice(0, 16),
        fastestLap: !!e?.fastestLap,
        local:      !!e?.local,
    };
}

async function pullReports() {
    const l = lobby();
    if (!l) return { added: 0, skipped: true };

    const cursor = await ResultCursor.findOne({ channelId: CURSOR_ID }).lean();
    const [boot = '', seq = '0'] = String(cursor?.lastMessageId || '').split(':');
    const res = await fetch(`${l.base}/v1/races/reports?since=${Number(seq) || 0}&boot=${encodeURIComponent(boot)}`, {
        headers: { 'X-MadPlus-League-Key': l.key },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`lobby ${res.status}`);
    const data = await res.json();

    let added = 0;
    for (const r of data.reports || []) {
        const entries = (Array.isArray(r.entries) ? r.entries : []).map(cleanEntry).filter(e => e.nick || e.madcarId);
        if (entries.length < 2) continue;
        const finishedAt = new Date(Number(r.finishedAt) || Number(r.receivedAt) || Date.now());
        const out = await RaceReport.updateOne(
            { reportKey: `${data.bootId}:${r.seq}` },
            { $setOnInsert: {
                reporterDiscordId: String(r.reporterDiscordId || ''),
                roomCode: String(r.roomCode || '').slice(0, 32),
                trackId: String(r.trackId || '').slice(0, 40),
                finishedAt, entries,
            } },
            { upsert: true },
        );
        if (out.upsertedCount) added++;

        // Raporu yollayanin kendi satiri -> bu Discord hesabi. Kendi Madcar ID'miz
        // her zaman gorunmuyor (kendi ozelliklerimiz giden trafikte); o zaman
        // oyun ici isimle bagla.
        const mine = entries.find(e => e.local);
        if (mine && r.reporterDiscordId && (mine.madcarId || norm(mine.nick))) {
            await MadcarLink.updateOne(
                { madcarId: mine.madcarId || `nick:${norm(mine.nick)}` },
                { $set: { discordId: String(r.reporterDiscordId), nick: mine.nick } },
                { upsert: true },
            );
        }
    }

    await ResultCursor.updateOne(
        { channelId: CURSOR_ID },
        { $set: { lastMessageId: `${data.bootId}:${data.lastSeq}`, scannedAt: new Date() } },
        { upsert: true },
    );
    return { added };
}

async function buildRaces(leagueRaces) {
    const reports = await RaceReport.find({ finishedAt: { $gte: new Date(Date.now() - REPORT_WINDOW_MS) } }).lean();
    const links = await MadcarLink.find({}).lean();
    const byMadcar = new Map(links.map(l => [l.madcarId, l.discordId]));
    const byNick = new Map();
    for (const l of links) if (l.nick) byNick.set(norm(l.nick), l.discordId);

    const keyOf = (e) => {
        const discordId = (e.madcarId && byMadcar.get(e.madcarId)) || byNick.get(norm(e.nick));
        if (discordId) return { key: `u:${discordId}`, userId: discordId };
        if (e.madcarId) return { key: `m:${e.madcarId}`, userId: null };
        const n = norm(e.nick);
        return n ? { key: `n:${n}`, userId: null } : null;
    };

    // 1) Ayni yaris birden fazla kisiden geldiyse tek yaris
    const groups = new Map();
    for (const r of reports) {
        const sig = `${r.roomCode || ''}|` + r.entries.map(e => `${e.position ?? 'x'}:${norm(e.nick)}`).sort().join(',');
        if (!groups.has(sig)) groups.set(sig, { report: r, reporters: new Set() });
        groups.get(sig).reporters.add(r.reporterDiscordId);
    }

    // 2) Lig sonuclari: isimleri hesaplara bagla, eslesen Mad+ raporunu bul
    const matched = new Set();
    const out = [];
    for (const race of leagueRaces) {
        const raceAt = new Date(race.raceAt).getTime();
        const names = new Set(race.entries.map(e => norm(e.name)).filter(Boolean));
        let hit = null;
        for (const [sig, g] of groups) {
            if (matched.has(sig)) continue;
            const ft = new Date(g.report.finishedAt).getTime();
            if (ft > raceAt + MATCH_AFTER_MS || ft < raceAt - MATCH_BEFORE_MS) continue;
            const overlap = g.report.entries.filter(e => names.has(norm(e.nick))).length;
            const need = Math.max(2, Math.ceil(0.6 * Math.min(names.size, g.report.entries.length)));
            if (overlap >= need) { hit = sig; break; }
        }

        const fromReport = new Map();
        if (hit) {
            matched.add(hit);
            for (const e of groups.get(hit).report.entries) {
                const k = keyOf(e);
                if (k) fromReport.set(norm(e.nick), k);
            }
        }

        const entries = race.entries.map(e => {
            if (e.userId) return e;
            const n = norm(e.name);
            const linked = byNick.get(n);
            if (linked) return { ...e, key: `u:${linked}`, userId: linked };
            const k = fromReport.get(n);           // Mad+ raporundaki Madcar ID
            return k ? { ...e, key: k.key, userId: k.userId } : e;
        });
        out.push({ ...race, entries, source: hit ? 'league_madplus' : race.source });
    }

    // 3) Eslesmeyen raporlar -> public oda yarisi (6 saat bekledikten sonra)
    for (const [sig, g] of groups) {
        if (matched.has(sig)) continue;
        const r = g.report;
        if (Date.now() - new Date(r.finishedAt).getTime() < PUBLIC_GRACE_MS) continue;
        const finished = [], dnf = [];
        const ordered = [...r.entries].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
        for (const e of ordered) {
            const k = keyOf(e);
            if (!k) continue;
            (e.position == null ? dnf : finished).push({ key: k.key, userId: k.userId, name: e.nick, dnf: e.position == null });
        }
        const entries = [...finished, ...dnf].map((e, i) => ({ ...e, position: i + 1 }));
        if (entries.length < 2) continue;
        out.push({ _id: `report:${String(r._id)}`, source: 'public', guildId: '', raceAt: r.finishedAt, memberCount: 0, entries });
    }
    return out;
}

async function pushRatings() {
    const l = lobby();
    if (!l) return { skipped: true };
    const rows = await MadRating.find({ userId: { $ne: null } }).lean();
    const drivers = rows.map(r => ({
        discordId: r.userId,
        name: r.name,
        rating: r.rating,
        level: r.level,
        races: r.races,
        wins: r.wins,
        podiums: r.podiums,
        peak: r.peak,
        placement: r.placement,
        placementRaces: engine.PLACEMENT_RACES,
        lastRaceAt: r.lastRaceAt ? new Date(r.lastRaceAt).getTime() : null,
        history: (r.history || []).map(h => ({
            at: h.at ? new Date(h.at).getTime() : null,
            rating: h.rating, delta: h.delta, place: h.place, field: h.field,
        })),
    }));
    const res = await fetch(`${l.base}/v1/ratings/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MadPlus-League-Key': l.key },
        body: JSON.stringify({ drivers }),
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`lobby ${res.status}`);
    return { pushed: drivers.length };
}

module.exports = { pullReports, buildRaces, pushRatings };

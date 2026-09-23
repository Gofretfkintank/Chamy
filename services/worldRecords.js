// services/worldRecords.js
// ───────────────────────────────────────────────────────────────────────────
// WR kanali parser'i -- AI YOK. M25'in WR kanalindaki format:
//
//   -------------------------------
//   ## Monza                      (bazen "#" olmadan: "Imola")
//   2004: <@id>  (37.08)
//   1991 (bugged): @name (1:55.28)
//   Hypercar:                     (bos sinif -> atlanir)
//   992: <@id>
//    (1:04.20)                    (sure alt satirda olabilir)
//
// "# -- Madcar Ultimate --" isaretinden sonraki pistler ayri oyun.
// Kanalda eski kopyalar var: her pist icin EN YENI mesaj gecerli.
// "IMPOSSIBLE LAPTIMES" ve 00.00.00 sureler atlanir.
// ───────────────────────────────────────────────────────────────────────────

const TrackRecord = require('../models/TrackRecord');

// Kanaldaki ad (normalize) -> Mad+ pist id'si. Madcar Ultimate pistleri eslenmez.
const MADPLUS_IDS = {
    'imola': 'imola',
    'austria': 'red-bull-ring',
    'spa': 'spa',
    'nurburgring': 'nurburgring',
    'suzuka': 'suzuka',
    'monza': 'monza',
    'france': 'castellet',
    'castellet': 'castellet',
    'silverstone': 'silverstone',
    'interlagos': 'interlagos',
    'portimao': 'portimao',
    'zandvoort': 'zandvoort',
    'montreal': 'montreal',
    'barcelona': 'barcelona',
    'mexico': 'mexico',
    'melbourne': 'melbourne',
    'lusail': 'qatar',
    'qatar': 'qatar',
    'hockenheim': 'hockenheim',
    'shanghai': 'shanghai',
    'budapest': 'budapest',
    'nuremberg': 'nuremberg',
    'nuremberg (r)': 'nuremberg-reverse',
    'sebring': 'sebring',
    'laguna seca': 'laguna-seca',
    'atlanta': 'road-atlanta',
    'le mans (no chicane)': 'sarthe',
    'bathurst': 'bathurst',
    'daytona (inside + chicaine)': 'daytona',
    'daytona (oval)': 'oval',
};

const GAP_RESETS_SECTION_MS = 30 * 60 * 1000; // ayri bir guncelleme turu = Ultimate bolumu biter

function norm(s) {
    return String(s || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** "1.18.82" / "1:18.82" / "38.54" / "48:98" -> { ms, text } */
function parseTime(raw) {
    const parts = String(raw).split(/[:.]/).filter(Boolean).map(Number);
    if (parts.some(n => !Number.isFinite(n))) return null;
    let m = 0, s, cs;
    if (parts.length === 3) [m, s, cs] = parts;
    else if (parts.length === 2) [s, cs] = parts;
    else return null;
    if (parts.length === 3 && s >= 60) return null;
    const ms = (m * 60 + s) * 1000 + cs * 10;
    if (ms <= 0) return null;
    const two = n => String(n).padStart(2, '0');
    return { ms, text: m ? `${m}:${two(s)}.${two(cs)}` : `${s}.${two(cs)}` };
}

function parseBlocks(content) {
    const lines = [];
    for (const raw of String(content || '').split('\n')) {
        const l = raw.trim();
        if (!l || /^-{3,}$/.test(l)) continue;
        // Sure alt satira dusmusse ("992: <@id>" / "(1:04.20)") onceki satira ekle
        if (/^\(/.test(l) && lines.length) lines[lines.length - 1] += ' ' + l;
        else lines.push(l);
    }

    const blocks = [];
    let cur = null;
    for (const l of lines) {
        const header = l.match(/^#{1,3}\s*(.+?)\s*$/);
        if (header) {
            cur = { title: header[1].replace(/^[-\s]+|[-\s]+$/g, ''), lines: [] };
            blocks.push(cur);
            continue;
        }
        const cls = l.match(/^([A-Za-z0-9][A-Za-z0-9 ]{0,20}?)\s*(\([^)]*\))?\s*:\s*(.*)$/);
        if (cls && cur) {
            cur.lines.push({ label: cls[1].trim(), note: (cls[2] || '').replace(/[()]/g, '').trim(), rest: cls[3] || '' });
        } else if (!cls) {
            // "Imola" gibi # olmadan yazilmis baslik
            cur = { title: l, lines: [] };
            blocks.push(cur);
        }
    }
    return blocks;
}

function parseEntry(line) {
    const time = line.rest.match(/\(\s*([\d:.]+)\s*\)/);
    if (!time) return null;
    const t = parseTime(time[1]);
    if (!t) return null;
    const id = line.rest.match(/<@!?(\d{15,21})>/);
    const at = line.rest.match(/@([^\s(<>]+)/);
    return {
        carClass: line.label,
        note:     line.note,
        holderId: id ? id[1] : null,
        holderName: id ? '' : (at ? at[1] : line.rest.replace(/\(.*$/, '').trim()),
        time:     t.text,
        timeMs:   t.ms,
    };
}

async function fetchMessages(channel, max = 600) {
    const out = [];
    let before;
    while (out.length < max) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!batch.size) break;
        out.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    return out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function resolveName(client, guild, id, cache) {
    if (cache.has(id)) return cache.get(id);
    let name = null;
    const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
    name = member?.displayName || null;
    if (!name) {
        const user = await client.users.fetch(id).catch(() => null);
        name = user?.globalName || user?.username || null;
    }
    cache.set(id, name || `user-${id.slice(-4)}`);
    return cache.get(id);
}

/**
 * Kanali tarar, her pistin en yeni WR tablosunu TrackRecord'a yazar.
 * -> { tracks, records, ultimate, unmatched: [pist adlari], latestAt }
 */
async function syncWorldRecords(channel) {
    const messages = await fetchMessages(channel);
    const latest = new Map(); // `${game}|${trackKey}` -> kayit

    let ultimate = false;
    let lastAt = 0;
    for (const msg of messages) {
        if (msg.createdTimestamp - lastAt > GAP_RESETS_SECTION_MS) ultimate = false;
        lastAt = msg.createdTimestamp;

        for (const block of parseBlocks(msg.content)) {
            if (/madcar ultimate/i.test(block.title)) { ultimate = true; continue; }
            if (/impossible/i.test(block.title)) continue;

            const records = block.lines.map(parseEntry).filter(Boolean);
            if (!records.length) continue;

            const game = ultimate ? 'madcar-ultimate' : 'madcar';
            const trackName = block.title.trim();
            const trackKey = slug(trackName);
            if (!trackKey) continue;

            latest.set(`${game}|${trackKey}`, {
                game, trackKey, trackName,
                madplusTrackId: game === 'madcar' ? (MADPLUS_IDS[norm(trackName)] || null) : null,
                records,
                sourceGuildId: channel.guildId || '',
                sourceChannelId: channel.id,
                sourceMessageId: msg.id,
                sourceAt: msg.createdAt,
            });
        }
    }

    // <@id> -> gorunen ad
    const names = new Map();
    for (const rec of latest.values()) {
        for (const r of rec.records) {
            if (r.holderId) r.holderName = await resolveName(channel.client, channel.guild, r.holderId, names);
        }
    }

    const now = new Date();
    const ops = [...latest.values()].map(rec => ({
        updateOne: {
            filter: { game: rec.game, trackKey: rec.trackKey },
            update: { $set: { ...rec, syncedAt: now } },
            upsert: true,
        },
    }));
    if (ops.length) await TrackRecord.bulkWrite(ops, { ordered: false });

    const all = [...latest.values()];
    return {
        tracks:    all.length,
        records:   all.reduce((n, r) => n + r.records.length, 0),
        ultimate:  all.filter(r => r.game === 'madcar-ultimate').length,
        unmatched: all.filter(r => r.game === 'madcar' && !r.madplusTrackId).map(r => r.trackName),
        latestAt:  all.reduce((d, r) => (r.sourceAt > d ? r.sourceAt : d), new Date(0)),
    };
}

async function findTrackRecords(query) {
    const key = slug(query);
    const mapped = MADPLUS_IDS[norm(query)];
    const esc = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return TrackRecord.find({
        $or: [
            { trackKey: key },
            { madplusTrackId: mapped || key },
            { trackName: new RegExp(esc, 'i') },
        ],
    }).sort({ game: 1, trackName: 1 }).limit(4).lean();
}

module.exports = { syncWorldRecords, findTrackRecords, parseBlocks, parseTime };

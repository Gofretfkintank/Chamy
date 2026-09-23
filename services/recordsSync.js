// services/recordsSync.js
// Kayitli dunya rekorlarini (TrackRecord) Mad+ lobby'sine yollar -> app'teki
// Tracks sayfasi. AI yok, tek HTTP istegi. Sadece normal Madcar ve Mad+'ta
// karsiligi olan pistler gider (Madcar Ultimate ve eslesmeyen pistler gitmez).
// Env: MADPLUS_LOBBY_URL, MADPLUS_LEAGUE_SYNC_KEY (league sync ile ayni).

const TrackRecord = require('../models/TrackRecord');

function lobbyBase() {
    return (process.env.MADPLUS_LOBBY_URL || '')
        .trim()
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
        .replace(/\/+$/, '');
}

async function pushRecords() {
    const base = lobbyBase();
    const key  = (process.env.MADPLUS_LEAGUE_SYNC_KEY || '').trim();
    if (!base || !key) return { skipped: true };

    const docs = await TrackRecord.find({ game: 'madcar', madplusTrackId: { $ne: null } }).lean();
    const tracks = docs.map(d => ({
        trackId:   d.madplusTrackId,
        trackName: d.trackName,
        updatedAt: d.sourceAt ? new Date(d.sourceAt).getTime() : null,
        classes:   (d.records || []).map(r => ({
            carClass:   r.carClass,
            holderName: r.holderName,
            time:       r.time,
            timeMs:     r.timeMs,
            note:       r.note || null,
        })),
    }));

    const res = await fetch(`${base}/v1/records/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-MadPlus-League-Key': key },
        body:    JSON.stringify({ tracks }),
        signal:  AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`lobby ${res.status}: ${text.slice(0, 200)}`);
    }
    return { pushed: tracks.length };
}

module.exports = { pushRecords };

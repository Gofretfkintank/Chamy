// lib/antiraid/engine.js
// Chamy antiraid'in HIZLI cekirdegi.
//
// Tasarim: "yarim saat sonra bakan" bot yerine, olay geldigi an BELLEKTE karar
// verir. Discord olayi (join, kanal/rol silme, ban) tetiklenir tetiklenmez
// buradaki kayan pencereler guncellenir ve esik gecilirse aksiyon ayni anda
// baslar. Veritabani sadece config okumak ve is bittikten sonra loglamak icin;
// karar yolunda (hot path) hic Mongo cagrisi yok.
//
// Bellek pencereleri process'te tutulur. Railway tek instance calistirdigi icin
// bu yeterli; birden fazla instance'a cikilirsa pencereler paylasilmali (o zaman
// Redis). Su an tek instance.

const configStore = require('./configStore');
const { protectFromJoinRaid, protectFromNuke } = require('./actions');

// guildId -> { joins: [{userId, at, young}], nukes: Map<actorId,[{at, kind}]> }
const windows = new Map();

function bucket(guildId) {
    let b = windows.get(guildId);
    if (!b) {
        b = { joins: [], nukes: new Map() };
        windows.set(guildId, b);
    }
    return b;
}

function prune(arr, cutoff) {
    // Pencereler kucuk (saniyeler), bastan kirpmak yeterince ucuz.
    let i = 0;
    while (i < arr.length && arr[i].at < cutoff) i++;
    if (i > 0) arr.splice(0, i);
}

/**
 * guildMemberAdd hot path. Yeni katilan uyeyi pencereye ekler; esik gecilirse
 * O ANDA join-raid korumasini tetikler. Karar icin await edilen tek sey config.
 */
async function onMemberJoin(member) {
    const cfg = await configStore.get(member.guild.id);
    if (!cfg.enabled) return;
    if (configStore.isWhitelisted(cfg, member.id, member.roles?.cache)) return;

    const now = Date.now();
    const accountAge = now - member.user.createdTimestamp;
    const young = accountAge < cfg.minAccountAgeMs;

    const b = bucket(member.guild.id);
    prune(b.joins, now - cfg.joinWindowMs);
    b.joins.push({ userId: member.id, at: now, young });

    // Genc hesaplar 2x sayilir: 3 genc hesap = 6 puan gibi.
    const score = b.joins.reduce((s, j) => s + (j.young ? 2 : 1), 0);
    if (score < cfg.joinThreshold) return;

    // Raid! Penceredeki herkesi al, pencereyi temizle (ayni dalgayi iki kez
    // islemeyelim).
    const wave = b.joins.slice();
    b.joins.length = 0;
    await protectFromJoinRaid(member.guild, cfg, wave).catch(err =>
        console.error('[ANTIRAID] join-raid action failed:', err.message));
}

/**
 * Nuke hot path (kanal/rol silme, toplu ban). actorId basina kayan pencere.
 * kind sadece loglama/aciklama icin. Esik gecilince nuke korumasi tetiklenir.
 */
async function onDestructiveAction(guild, actorId, kind) {
    if (!actorId) return;
    const cfg = await configStore.get(guild.id);
    if (!cfg.enabled) return;
    if (configStore.isWhitelisted(cfg, actorId)) return;
    // Sunucu sahibine dokunma.
    if (actorId === guild.ownerId) return;

    const now = Date.now();
    const b = bucket(guild.id);
    let arr = b.nukes.get(actorId);
    if (!arr) { arr = []; b.nukes.set(actorId, arr); }
    prune(arr, now - cfg.nukeWindowMs);
    arr.push({ at: now, kind });

    if (arr.length < cfg.nukeThreshold) return;

    b.nukes.delete(actorId); // ayni faili tekrar tetikleme
    await protectFromNuke(guild, cfg, actorId, arr).catch(err =>
        console.error('[ANTIRAID] nuke action failed:', err.message));
}

module.exports = { onMemberJoin, onDestructiveAction };

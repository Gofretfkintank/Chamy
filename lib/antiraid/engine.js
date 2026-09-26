// lib/antiraid/engine.js
// Chamy antiraid'in HIZLI cekirdegi. Karar bellekte, olay geldigi an.
//
// Join tarafinda uc katman:
//   1) Hizli dalga : joinWindowMs icinde puan >= joinThreshold (genc hesap 2 puan).
//   2) Yavas kume  : son 10 dk'da birbirine benzeyen (ayni saatlerde acilmis,
//                    benzer isimli, ayni/varsayilan avatarli) 5+ hesap.
//   3) Raid modu   : raid tespit edildikten sonra 3 dk boyunca gelen her supheli
//                    hesap tek tek degerlendirilmeden toplu ban kuyruguna girer.
// Her durumda dalgaya denk gelen gercek gorunumlu uyeler (eski hesap, kendine
// ozgu avatar, kumede degil) AYIKLANIR, banlanmaz.

const configStore = require('./configStore');
const cluster = require('./cluster');
const { protectFromJoinRaid, protectFromNuke, queueBan } = require('./actions');
const lockdown = require('./lockdown');

const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
const CLUSTER_MAX = 200;
const CLUSTER_RAID_SIZE = 5;          // f + en az 4 benzer
const RAID_MODE_MS = 3 * 60 * 1000;

// guildId -> { joins:[], pool:[], raidUntil, nukes: Map<actorId, [{at, kind}]> }
const windows = new Map();

function bucket(guildId) {
    let b = windows.get(guildId);
    if (!b) {
        b = { joins: [], pool: [], raidUntil: 0, nukes: new Map() };
        windows.set(guildId, b);
    }
    return b;
}

function prune(arr, cutoff) {
    let i = 0;
    while (i < arr.length && arr[i].at < cutoff) i++;
    if (i > 0) arr.splice(0, i);
}

async function onMemberJoin(member) {
    const cfg = await configStore.get(member.guild.id);
    if (!cfg.enabled) return;
    if (configStore.isWhitelisted(cfg, member.id, member.roles?.cache)) return;
    if (member.user.bot) return; // botlar audit log (BotAdd) tarafinda izlenir

    const now = Date.now();
    const f = cluster.features(member);
    f.young = now - f.createdAt < cfg.minAccountAgeMs;

    const b = bucket(member.guild.id);
    prune(b.joins, now - cfg.joinWindowMs);
    prune(b.pool, now - CLUSTER_WINDOW_MS);
    if (b.pool.length >= CLUSTER_MAX) b.pool.shift();
    b.pool.push(f);

    // 3) Raid modu: raid suruyor, supheliyi direkt kuyruga at, kilidi uzat.
    if (b.raidUntil > now) {
        if (cluster.isSuspect(f, b.pool)) {
            queueBan(member.guild, member.id, '[Chamy Antiraid] Joined during an active raid');
            b.raidUntil = now + RAID_MODE_MS;
            lockdown.engage(member.guild, cfg).catch(() => {});
        }
        return;
    }

    b.joins.push(f);

    // 1) Hizli dalga.
    const score = b.joins.reduce((s, j) => s + (j.young ? 2 : 1), 0);
    let wave = null;
    let kind = null;
    if (score >= cfg.joinThreshold) {
        wave = b.joins.slice();
        kind = 'fast';
    } else {
        // 2) Yavas kume.
        const mates = cluster.mates(f, b.pool);
        if (mates.length + 1 >= CLUSTER_RAID_SIZE) {
            wave = [f, ...mates];
            kind = 'cluster';
        }
    }
    if (!wave) return;

    b.joins.length = 0;
    b.raidUntil = now + RAID_MODE_MS;

    const suspects = [];
    const spared = [];
    for (const j of wave) (cluster.isSuspect(j, b.pool) ? suspects : spared).push(j);
    // Havuzdan cikar ki ayni hesaplar tekrar kume olusturmasin.
    const done = new Set(wave.map(j => j.userId));
    b.pool = b.pool.filter(p => !done.has(p.userId));

    // Dalga tamamen gercek gorunumlu uyelerden olusuyorsa (yayin/duyuru akini) raid degil.
    if (!suspects.length) {
        b.raidUntil = 0;
        return;
    }

    await protectFromJoinRaid(member.guild, cfg, suspects, spared, kind).catch(err =>
        console.error('[ANTIRAID] join-raid action failed:', err.message));
}

/**
 * Nuke hot path (kanal/rol silme, toplu ban, tehlikeli yetki dagitma).
 * actorId basina kayan pencere; esik gecilince nuke korumasi tetiklenir.
 */
async function onDestructiveAction(guild, actorId, kind) {
    if (!actorId) return;
    const cfg = await configStore.get(guild.id);
    if (!cfg.enabled) return;
    if (configStore.isWhitelisted(cfg, actorId)) return;
    if (actorId === guild.ownerId) return;

    const now = Date.now();
    const b = bucket(guild.id);
    let arr = b.nukes.get(actorId);
    if (!arr) { arr = []; b.nukes.set(actorId, arr); }
    prune(arr, now - cfg.nukeWindowMs);
    arr.push({ at: now, kind });

    if (arr.length < cfg.nukeThreshold) return;

    b.nukes.delete(actorId);
    await protectFromNuke(guild, cfg, actorId, arr).catch(err =>
        console.error('[ANTIRAID] nuke action failed:', err.message));
}

module.exports = { onMemberJoin, onDestructiveAction };

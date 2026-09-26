// lib/antiraid/spam.js
// Mesaj spami. Once bir spam kurali tetiklenmeli (link spami, sel, cok kanal,
// toplu etiket, koordineli). Sonra CEZA, spamin ICERIGINE gore secilir:
//
//   KESIN RAID ICERIGI  -> BAN (tum kanallardaki mesajlari da silinir)
//     xxx / scam link, davet linki, @everyone + link, 4+ hesaptan ayni mesaj,
//     "raided by / fucked by X", "X IS THE BEST" tarzi sunucu reklami,
//     xxx kelimeleriyle atilan resim/video.
//
//   TROLL / SIKILMA SPAMI (copypasta, "ratio ratio", emoji duvari, sel):
//     guven skoru < 20  -> 1 saat timeout + mesajlar silinir
//     guven skoru >= 20 -> sadece mesajlar silinir (tanidik uye trollemesi)

const { PermissionsBitField } = require('discord.js');
const configStore = require('./configStore');
const { sendAlert } = require('./alert');
const { escalateToGlobal } = require('./actions');
const { trustOf } = require('../trust/score');

const LOW_TRUST = 20;
const WINDOW_MS = 12_000;
const FLOOD_MSGS = 7;          // 5 sn'de 7+ mesaj = sel
const FLOOD_MS = 5_000;
const CROSS_CHANNELS = 3;      // ayni icerik 3+ farkli kanalda
const MASS_MENTIONS = 5;       // tek mesajda 5+ farkli kullanici etiketi
const COORDINATED_USERS = 4;   // ayni icerik 4+ farkli hesaptan = koordineli raid
const TIMEOUT_MS = 60 * 60 * 1000;
const NEW_MEMBER_MS = 24 * 60 * 60 * 1000;     // sunucuya son 24 saatte girmis
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000; // hesap 7 gunden genc

// xxx / scam kaliplari. Tek basina kelime yetmez; link, resim/video ya da
// baska bir spam kuraliyla birlikte aranir.
const NSFW_WORDS = /\b(nsfw|18\+|onlyfans|only\s*fans|nudes?|porn|p[o0]rn|sex|xxx|leaks?|hentai|teen\s*girls?|free\s*nitro|steam\s*gift|nitro\s*gift)\b/i;
const LINK = /(https?:\/\/|discord\.gg\/|discord(app)?\.com\/invite\/|\bt\.me\/)/i;
const INVITE = /(discord\.gg\/|discord(app)?\.com\/invite\/)/i;
// Raid imzasi: "raided by X", "fucked by X", "X IS THE BEST / ON TOP".
// Sadece bir spam kurali ZATEN tetiklendiyse bakilir; normal sohbette
// "verstappen is the best" diyen kimse bu yuzden banlanmaz.
const RAID_PHRASE = /\b(raided|fucked|nuked|owned|destroyed|hacked|smoked)\s+by\b|\b(is|are)\s+(the\s+)?(best|top|king|goat)\b|\bon\s+top\b|\bget\s+(raided|nuked)\b/i;

// guildId -> Map(userId -> [{at, channelId, id, hash}])
const perUser = new Map();
// guildId -> Map(hash -> [{at, userId}])
const perContent = new Map();
// Ayni kullaniciyi ayni dalgada iki kez islemeyelim.
const handled = new Map(); // `${guildId}:${userId}` -> expiresAt

function norm(content) {
    return content.toLowerCase().replace(/\s+/g, ' ').replace(/<@!?\d+>/g, '@u').trim();
}

function prune(arr, cutoff) {
    let i = 0;
    while (i < arr.length && arr[i].at < cutoff) i++;
    if (i) arr.splice(0, i);
}

function mapGet(m, k) {
    let v = m.get(k);
    if (!v) { v = new Map(); m.set(k, v); }
    return v;
}

async function onMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const member = message.member;
    if (!member) return;

    const cfg = await configStore.get(message.guild.id);
    if (!cfg.enabled) return;
    if (configStore.isWhitelisted(cfg, member.id, member.roles.cache)) return;
    // Yetkililere dokunma.
    if (member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

    const key = `${message.guild.id}:${member.id}`;
    const h = handled.get(key);
    if (h && h > Date.now()) {
        // Zaten islendi; gelen yeni mesajlari da sil.
        message.delete().catch(() => {});
        return;
    }

    const now = Date.now();
    const content = message.content || '';
    const hash = content.length >= 6 ? norm(content) : null;
    const hasMedia = message.attachments?.size > 0 || message.embeds?.some(e => e.image || e.video || e.thumbnail);

    const users = mapGet(perUser, message.guild.id);
    let list = users.get(member.id);
    if (!list) { list = []; users.set(member.id, list); }
    prune(list, now - WINDOW_MS);
    list.push({ at: now, channelId: message.channelId, id: message.id, hash });

    let reason = null;
    let raid = false; // kesin raid icerigi mi

    // 1) xxx / scam link, ya da yeni gelenin davet linki -> kesin raid.
    const joinedRecently = member.joinedTimestamp && now - member.joinedTimestamp < NEW_MEMBER_MS;
    if (LINK.test(content) && NSFW_WORDS.test(content)) { reason = 'NSFW/scam link spam'; raid = true; }
    else if (hasMedia && NSFW_WORDS.test(content)) { reason = 'NSFW media spam'; raid = true; }
    else if (joinedRecently && INVITE.test(content)) { reason = 'Invite link from a new member'; raid = true; }

    // 2) @everyone denemesi (yetkisi yok) + link -> kesin raid.
    if (!reason && /@(everyone|here)/.test(content) && LINK.test(content) &&
        !member.permissions.has(PermissionsBitField.Flags.MentionEveryone)) {
        reason = '@everyone + link spam';
        raid = true;
    }

    // 3) Toplu etiket.
    if (!reason && message.mentions.users.size >= MASS_MENTIONS) reason = `Mass mention (${message.mentions.users.size} users)`;

    // 4) Ayni mesaj 3+ farkli kanalda.
    if (!reason && hash) {
        const chans = new Set(list.filter(e => e.hash === hash).map(e => e.channelId));
        if (chans.size >= CROSS_CHANNELS) reason = `Same message in ${chans.size} channels`;
    }

    // 5) Mesaj seli.
    if (!reason) {
        const recent = list.filter(e => e.at >= now - FLOOD_MS).length;
        if (recent >= FLOOD_MSGS) reason = `Message flood (${recent} in ${FLOOD_MS / 1000}s)`;
    }

    // 6) Koordineli: ayni icerik 4+ farkli hesaptan -> kesin raid.
    let coordinated = null;
    if (hash) {
        const contents = mapGet(perContent, message.guild.id);
        let who = contents.get(hash);
        if (!who) { who = []; contents.set(hash, who); }
        prune(who, now - WINDOW_MS);
        who.push({ at: now, userId: member.id });
        const distinct = [...new Set(who.map(w => w.userId))];
        if (distinct.length >= COORDINATED_USERS) {
            coordinated = distinct;
            contents.delete(hash);
            reason = reason || `Coordinated spam (${distinct.length} accounts)`;
            raid = true;
        }
    }

    if (!reason) return;

    // Spam kurali tetiklendi; icerikte raid imzasi (sunucu daveti, "raided by",
    // "X is the best") varsa troll degil, raid say. Siradan linkler (tenor gif,
    // youtube) raid sayilmaz; arkadaslar gif spamlarsa ban yemesin.
    if (!raid && (RAID_PHRASE.test(content) || INVITE.test(content))) raid = true;

    const targets = coordinated || [member.id];
    await Promise.all(targets.map(uid => punish(message.guild, cfg, uid, reason, raid)));
}

async function punish(guild, cfg, userId, reason, raid) {
    const key = `${guild.id}:${userId}`;
    if ((handled.get(key) || 0) > Date.now()) return;
    handled.set(key, Date.now() + 60_000);

    const me = guild.members.me;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const now = Date.now();
    const newAccount = member && now - member.user.createdTimestamp < NEW_ACCOUNT_MS;
    const newMember = member?.joinedTimestamp && now - member.joinedTimestamp < NEW_MEMBER_MS;
    const tag = `[Chamy Antiraid] ${reason}`;

    let action;
    let trustNote = '';

    if (raid) {
        // Kesin raid icerigi: kim olursa olsun ban (eski uyeyse hesabi calinmistir).
        const ok = me?.permissions.has(PermissionsBitField.Flags.BanMembers)
            ? await guild.bans.create(userId, { reason: tag, deleteMessageSeconds: 3600 }).then(() => true).catch(() => false)
            : false;
        if (ok) {
            action = 'banned (raid content — messages in all channels wiped)';
            // Global listeye sadece yeni hesaplar/yeni gelenler aday olur; calinmis eski
            // uye hesabi geri alinca baska sunuculardan da atilmis olmasin.
            if (newAccount || newMember) escalateToGlobal(guild.id, [userId], 'Spam raid').catch(() => {});
        } else {
            // Ban basarisiz (izin / hiyerarsi): en azindan sustur + temizle.
            await timeout(member, me, tag);
            const deleted = await wipeTracked(guild, userId);
            action = `ban failed — timed out 1h, ${deleted} messages deleted`;
        }
    } else {
        // Troll / sikilma spami: guven skoruna gore.
        const trust = member ? (await trustOf(member).catch(() => null))?.score ?? 50 : 0;
        trustNote = ` · trust ${trust}/100`;
        const deleted = await wipeTracked(guild, userId);
        if (trust < LOW_TRUST) {
            await timeout(member, me, tag);
            action = `timed out 1h, ${deleted} messages deleted`;
        } else {
            action = `${deleted} messages deleted (trusted member — no timeout)`;
        }
    }

    perUser.get(guild.id)?.delete(userId);
    await sendAlert(guild, cfg, {
        title: raid ? '🚨 Raid spam stopped' : '🧹 Spam cleaned',
        lines: [`<@${userId}> — **${reason}**${trustNote}`, `Action: ${action}`],
    });
}

async function timeout(member, me, tag) {
    if (member && me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        await member.timeout(TIMEOUT_MS, tag).catch(() => {});
    }
}

async function wipeTracked(guild, userId) {
    const list = perUser.get(guild.id)?.get(userId) || [];
    const byChannel = new Map();
    for (const e of list) {
        if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []);
        byChannel.get(e.channelId).push(e.id);
    }
    let n = 0;
    await Promise.all([...byChannel].map(async ([chId, ids]) => {
        const ch = guild.channels.cache.get(chId);
        if (!ch?.bulkDelete) return;
        const res = await ch.bulkDelete(ids, true).catch(() => null);
        n += res?.size || 0;
    }));
    return n;
}

// Bellek temizligi: bos pencereleri dakikada bir at.
setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const users of perUser.values()) {
        for (const [uid, list] of users) { prune(list, cutoff); if (!list.length) users.delete(uid); }
    }
    for (const contents of perContent.values()) {
        for (const [h, who] of contents) { prune(who, cutoff); if (!who.length) contents.delete(h); }
    }
    const now = Date.now();
    for (const [k, exp] of handled) if (exp < now) handled.delete(k);
}, 60_000).unref?.();

module.exports = { onMessage };

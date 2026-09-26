// lib/antiraid/spam.js
// Mesaj spami: xxx/scam link spami, hack'lenmis hesaplarin her kanala ayni mesaji
// atmasi, mesaj seli, toplu etiket, birden cok hesabin ayni mesaji atmasi.
//
// Ayni prensip: karar bellekte, mesaj geldigi an. Aksiyon:
//   - Yeni hesap / sunucuya yeni girmis -> BAN (deleteMessageSeconds ile tum
//     kanallardaki mesajlari da tek istekte silinir).
//   - Eski uye (buyuk ihtimalle hesabi calinmis) -> banlanmaz; timeout + mesajlari
//     silinir + modlara "hesap calinmis olabilir" uyarisi.

const { PermissionsBitField } = require('discord.js');
const configStore = require('./configStore');
const { sendAlert } = require('./alert');
const { escalateToGlobal } = require('./actions');

const WINDOW_MS = 12_000;
const FLOOD_MSGS = 7;          // 5 sn'de 7+ mesaj = sel
const FLOOD_MS = 5_000;
const CROSS_CHANNELS = 3;      // ayni icerik 3+ farkli kanalda = hack'li hesap spami
const MASS_MENTIONS = 5;       // tek mesajda 5+ farkli kullanici etiketi
const COORDINATED_USERS = 4;   // ayni icerik 4+ farkli hesaptan = koordineli raid
const TIMEOUT_MS = 60 * 60 * 1000;
const NEW_MEMBER_MS = 24 * 60 * 60 * 1000;     // sunucuya son 24 saatte girmis
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000; // hesap 7 gunden genc

// Tipik xxx / scam spam kaliplari. Tek basina kelime degil, LINK/davet ile birlikte
// aranir ki normal sohbette gecen bir kelime yuzunden kimse banlanmasin.
const NSFW_WORDS = /\b(nsfw|18\+|onlyfans|only\s*fans|nudes?|porn|p[o0]rn|sex|xxx|leaks?|hentai|teen\s*girls?|free\s*nitro|steam\s*gift|nitro\s*gift|@everyone\s*free)\b/i;
const LINK = /(https?:\/\/|discord\.gg\/|discord(app)?\.com\/invite\/|\bt\.me\/)/i;
const INVITE = /(discord\.gg\/|discord(app)?\.com\/invite\/)/i;

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

    const users = mapGet(perUser, message.guild.id);
    let list = users.get(member.id);
    if (!list) { list = []; users.set(member.id, list); }
    prune(list, now - WINDOW_MS);
    list.push({ at: now, channelId: message.channelId, id: message.id, hash });

    let reason = null;

    // 1) xxx / scam link: NSFW kelime + link, ya da yeni gelen birinin davet linki.
    const joinedRecently = member.joinedTimestamp && now - member.joinedTimestamp < NEW_MEMBER_MS;
    if (LINK.test(content) && NSFW_WORDS.test(content)) reason = 'NSFW/scam link spam';
    else if (joinedRecently && INVITE.test(content)) reason = 'Invite link from a new member';

    // 2) @everyone denemesi (yetkisi yok) + link.
    if (!reason && /@(everyone|here)/.test(content) && LINK.test(content) &&
        !member.permissions.has(PermissionsBitField.Flags.MentionEveryone)) {
        reason = '@everyone + link spam';
    }

    // 3) Toplu etiket.
    if (!reason && message.mentions.users.size >= MASS_MENTIONS) reason = `Mass mention (${message.mentions.users.size} users)`;

    // 4) Ayni mesaj 3+ farkli kanalda (calinmis hesap klasigi).
    if (!reason && hash) {
        const chans = new Set(list.filter(e => e.hash === hash).map(e => e.channelId));
        if (chans.size >= CROSS_CHANNELS) reason = `Same message in ${chans.size} channels`;
    }

    // 5) Mesaj seli.
    if (!reason) {
        const recent = list.filter(e => e.at >= now - FLOOD_MS).length;
        if (recent >= FLOOD_MSGS) reason = `Message flood (${recent} in ${FLOOD_MS / 1000}s)`;
    }

    // 6) Koordineli: ayni icerik 4+ farkli hesaptan.
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
            if (!reason) reason = `Coordinated spam (${distinct.length} accounts)`;
        }
    }

    if (!reason) return;

    const targets = coordinated || [member.id];
    await Promise.all(targets.map(uid => punish(message.guild, cfg, uid, reason)));
}

async function punish(guild, cfg, userId, reason) {
    const key = `${guild.id}:${userId}`;
    if ((handled.get(key) || 0) > Date.now()) return;
    handled.set(key, Date.now() + 60_000);

    const me = guild.members.me;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const now = Date.now();
    const newAccount = member && now - member.user.createdTimestamp < NEW_ACCOUNT_MS;
    const newMember = member?.joinedTimestamp && now - member.joinedTimestamp < NEW_MEMBER_MS;
    // Guven skoru: hic etkilesimi olmayan / raid kesfi bayragi yemis eski uye de
    // yeni gelen gibi muamele gorur. Skor tek basina ban sebebi DEGIL; sadece
    // zaten spam kuralina takilmis birine ne kadar sert davranilacagini belirler.
    const trust = member ? (await trustOf(member).catch(() => null))?.score ?? 50 : 0;
    const lowTrust = trust < LOW_TRUST;
    const tag = `[Chamy Antiraid] ${reason}`;

    let action;
    if ((newAccount || newMember || lowTrust) && me?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        // Yeni gelen spammer: banla; ban son 1 saatteki tum mesajlarini da siler.
        const ok = await guild.bans.create(userId, { reason: tag, deleteMessageSeconds: 3600 })
            .then(() => true).catch(() => false);
        action = ok ? 'banned (messages wiped)' : 'ban failed';
        if (ok) escalateToGlobal(guild.id, [userId], 'Spam raid').catch(() => {});
    } else {
        // Eski uye: buyuk ihtimalle hesabi calinmis. Banlama, sustur + temizle.
        if (member && me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            await member.timeout(TIMEOUT_MS, tag).catch(() => {});
        }
        const deleted = await wipeTracked(guild, userId);
        action = `timed out 1h, ${deleted} messages deleted (older member — account may be compromised)`;
    }

    perUser.get(guild.id)?.delete(userId);
    await sendAlert(guild, cfg, {
        title: '🧹 Spam stopped',
        lines: [`<@${userId}> — **${reason}**`, `Action: ${action}`],
    });
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

// lib/antiraid/actions.js
// Raid tespit edilince yapilan is. Hedef: raid botuyla ayni hizda olmak, o yuzden
// tum ban/timeout'lar Promise.all ile PARALEL gonderilir, sirayla degil.

const { PermissionsBitField } = require('discord.js');
const configStore = require('./configStore');
const { sendAlert } = require('./alert');
const GlobalBan = require('../../models/GlobalBan');

const TIMEOUT_MS = 60 * 60 * 1000; // raid netlesene kadar 1 saat timeout

function me(guild) { return guild.members.me; }
function canBan(guild) {
    return me(guild)?.permissions.has(PermissionsBitField.Flags.BanMembers);
}
function canModerate(guild) {
    return me(guild)?.permissions.has(PermissionsBitField.Flags.ModerateMembers);
}

/**
 * Join-raid: karar "once sustur, sonra banla". Penceredeki her hesap ANINDA
 * timeout'lanir (yanlislikla yakalanan gercek uye modlarca kurtarilabilsin),
 * sonra hepsi paralel banlanir. Ban raid'i durdurmanin kesin yolu; timeout
 * ban rol siralamasi / izin yuzunden basarisiz olursa en azindan susturur.
 */
async function protectFromJoinRaid(guild, cfg, wave) {
    const reason = `[Chamy Antiraid] Join raid: ${wave.length} accounts in ${cfg.joinWindowMs}ms`;
    console.warn(`[ANTIRAID] 🚨 ${guild.name} (${guild.id}) — ${reason}`);

    // 1) Aninda sustur (ban'dan hizli baslar, ban basarisiz olsa bile zarar durur).
    if (canModerate(guild)) {
        await Promise.all(wave.map(j =>
            guild.members.cache.get(j.userId)
                ?.timeout(TIMEOUT_MS, reason).catch(() => {})));
    }

    // 2) Paralel banla.
    let banned = 0;
    if (canBan(guild)) {
        const results = await Promise.all(wave.map(j =>
            guild.bans.create(j.userId, { reason, deleteMessageSeconds: 3600 })
                .then(() => true).catch(() => false)));
        banned = results.filter(Boolean).length;
    }

    // 3) Tekrarlayan failleri global listeye dogru itele (birden fazla sunucuda
    //    raide karisan hesap otomatik global-ban adayina donusur).
    escalateToGlobal(guild.id, wave.map(j => j.userId), 'Join raid').catch(() => {});

    await sendAlert(guild, cfg, {
        title: '🚨 Join raid stopped',
        lines: [
            `**${wave.length}** accounts joined in under ${Math.round(cfg.joinWindowMs / 1000)}s.`,
            `Banned: **${banned}/${wave.length}**${canBan(guild) ? '' : ' (missing Ban permission!)'}`,
            wave.length <= 20
                ? wave.map(j => `• <@${j.userId}>${j.young ? ' (new account)' : ''}`).join('\n')
                : '_Too many to list._',
        ],
    });
}

/**
 * Nuke: ele gecirilmis/kotu niyetli yetkili kanal/rol siliyor ya da toplu ban
 * atiyor. Kullanicinin secimi: "rolleri aninda al". Butun rollerini soyup
 * susturur; sonra silinenleri snapshot'tan geri kurar.
 */
async function protectFromNuke(guild, cfg, actorId, events) {
    const reason = `[Chamy Antiraid] Nuke: ${events.length} destructive actions in ${cfg.nukeWindowMs}ms`;
    console.warn(`[ANTIRAID] 💣 ${guild.name} (${guild.id}) — actor ${actorId} — ${reason}`);

    const member = await guild.members.fetch(actorId).catch(() => null);
    let stripped = 0;
    if (member && me(guild)?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const removable = member.roles.cache.filter(r =>
            r.id !== guild.id &&            // @everyone
            !r.managed &&                   // entegrasyon rolleri
            r.position < me(guild).roles.highest.position, // hiyerarsi
        );
        // Timeout + tum rolleri paralel al.
        await Promise.all([
            canModerate(guild) ? member.timeout(TIMEOUT_MS, reason).catch(() => {}) : null,
            ...removable.map(r => member.roles.remove(r, reason).then(() => { stripped++; }).catch(() => {})),
        ]);
    }

    // Snapshot'tan geri kur (kanallar + roller).
    let restore = null;
    try {
        restore = await require('./restore').restoreLatest(guild);
    } catch (err) {
        console.error('[ANTIRAID] restore failed:', err.message);
    }

    escalateToGlobal(guild.id, [actorId], 'Nuke').catch(() => {});

    await sendAlert(guild, cfg, {
        title: '💣 Nuke stopped',
        lines: [
            `<@${actorId}> ran **${events.length}** destructive actions in under ${Math.round(cfg.nukeWindowMs / 1000)}s.`,
            `Roles stripped: **${stripped}**, timed out for 1h.`,
            restore
                ? `Restored **${restore.channels}** channels, **${restore.roles}** roles from snapshot (${restore.when}).`
                : '_No snapshot to restore from — run `/antiraid snapshot` after fixing the server._',
        ],
    });
}

/**
 * Bir hesabin raide karistigi sunuculari biriktirir; 2+ ayri sunucuda gorulurse
 * global-ban listesine ekler (Chamy'nin oldugu her acik sunucuda otomatik atilir).
 */
async function escalateToGlobal(guildId, userIds, kind) {
    for (const userId of userIds) {
        try {
            const doc = await GlobalBan.findOneAndUpdate(
                { userId },
                { $addToSet: { hitGuilds: guildId }, $setOnInsert: { reason: kind, addedBy: 'auto' } },
                { upsert: true, new: true },
            );
            // 2 ayri sunucuda raide karistiysa artik global.
            if (doc.hitGuilds.length >= 2) configStore.invalidateGlobalBans();
        } catch { /* yut */ }
    }
}

module.exports = { protectFromJoinRaid, protectFromNuke, escalateToGlobal };

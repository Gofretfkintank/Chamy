// lib/antiraid/lockdown.js
// Buyuk raidde en ucuz ve en etkili hamle: kaynagi kesmek. Tek API cagrisiyla
// davetler dondurulur ve dogrulama seviyesi yukseltilir; raid botlari girmeye
// devam edemez, rate limit'e bogulacak yuzlerce ban gerekmez.
//
// Durum Mongo'da tutulur: Chamy raid sirasinda yeniden baslarsa kilit acilmadan
// kalmasin diye acilista kaldigi yerden zamanlanir.

const { GuildVerificationLevel, PermissionsBitField } = require('discord.js');
const AntiraidConfig = require('../../models/AntiraidConfig');
const configStore = require('./configStore');
const { sendAlert } = require('./alert');

const LOCK_MS = 10 * 60 * 1000; // son raid girisinden 10 dk sonra acilir
const timers = new Map(); // guildId -> timeout

function canManageGuild(guild) {
    return guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function schedule(client, guildId, until) {
    clearTimeout(timers.get(guildId));
    const delay = Math.max(1000, new Date(until).getTime() - Date.now());
    timers.set(guildId, setTimeout(() => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) release(guild, 'timer').catch(err => console.error('[ANTIRAID] unlock failed:', err.message));
    }, delay));
}

/** Kilitle ya da zaten kilitliyse sureyi uzat. */
async function engage(guild, cfg) {
    if (!canManageGuild(guild)) return false;
    const until = new Date(Date.now() + LOCK_MS);
    const doc = await AntiraidConfig.findOne({ guildId: guild.id }).lean();

    if (doc?.lockdownUntil && new Date(doc.lockdownUntil) > new Date()) {
        // Zaten kilitli: sadece uzat.
        await AntiraidConfig.updateOne({ guildId: guild.id }, { $set: { lockdownUntil: until } });
        schedule(guild.client, guild.id, until);
        return true;
    }

    const prevLevel = guild.verificationLevel;
    const invitesWerePaused = guild.features?.includes('INVITES_DISABLED') ?? false;
    const reason = '[Chamy Antiraid] Raid lockdown';

    await Promise.all([
        prevLevel < GuildVerificationLevel.High
            ? guild.setVerificationLevel(GuildVerificationLevel.High, reason).catch(() => {})
            : null,
        !invitesWerePaused && guild.disableInvites
            ? guild.disableInvites(true).catch(() => {})
            : null,
    ]);

    await AntiraidConfig.updateOne(
        { guildId: guild.id },
        { $set: { lockdownUntil: until, lockdownPrevLevel: prevLevel, lockdownInvitesWerePaused: invitesWerePaused } },
        { upsert: true },
    );
    configStore.invalidate(guild.id);
    schedule(guild.client, guild.id, until);

    await sendAlert(guild, cfg, {
        title: '🔒 Server locked down',
        lines: [
            'Invites are paused and verification is raised to **High** to stop the raid at the source.',
            'It unlocks automatically 10 minutes after the last raid join, or use `/antiraid unlock`.',
        ],
    });
    return true;
}

async function release(guild, why = 'manual') {
    clearTimeout(timers.get(guild.id));
    timers.delete(guild.id);
    const doc = await AntiraidConfig.findOne({ guildId: guild.id }).lean();
    if (!doc?.lockdownUntil) return false;

    const reason = `[Chamy Antiraid] Lockdown released (${why})`;
    await Promise.all([
        doc.lockdownPrevLevel != null && guild.verificationLevel !== doc.lockdownPrevLevel
            ? guild.setVerificationLevel(doc.lockdownPrevLevel, reason).catch(() => {})
            : null,
        !doc.lockdownInvitesWerePaused && guild.disableInvites
            ? guild.disableInvites(false).catch(() => {})
            : null,
    ]);
    await AntiraidConfig.updateOne(
        { guildId: guild.id },
        { $unset: { lockdownUntil: '', lockdownPrevLevel: '', lockdownInvitesWerePaused: '' } },
    );
    configStore.invalidate(guild.id);

    const cfg = await configStore.get(guild.id);
    await sendAlert(guild, cfg, {
        title: '🔓 Lockdown released',
        lines: ['Invites and verification level are back to normal.'],
    });
    return true;
}

/** Acilista: raid sirasinda yeniden baslamissak kilitleri tekrar zamanla. */
async function resume(client) {
    const docs = await AntiraidConfig.find({ lockdownUntil: { $ne: null } }).lean().catch(() => []);
    for (const d of docs) {
        if (client.guilds.cache.has(d.guildId)) schedule(client, d.guildId, d.lockdownUntil);
    }
}

module.exports = { engage, release, resume };

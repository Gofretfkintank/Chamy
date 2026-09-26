// lib/antiraid/restore.js
// Nuke sonrasi snapshot'tan kanal + rol geri kurma. Ommy-Antiraid'deki
// restore.js ile ayni yaklasim: adiyla mevcut olmayanlari yeniden olusturur.

const { ChannelType } = require('discord.js');
const { latestSnapshot } = require('./snapshot');

async function restoreLatest(guild) {
    const snap = await latestSnapshot(guild.id);
    if (!snap) return null;

    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const when = new Date(snap.createdAt).toLocaleString('en-GB');
    const reason = `[Chamy Antiraid] Nuke restore — ${when}`;
    let roles = 0, channels = 0;

    // Roller (yuksekten alcaga), adiyla var olanlari atla.
    const haveRole = new Set(guild.roles.cache.map(r => r.name));
    for (const r of snap.roles.filter(r => r.name !== '@everyone' && !haveRole.has(r.name))
        .sort((a, b) => b.position - a.position)) {
        try {
            await guild.roles.create({
                name: r.name, color: r.color,
                permissions: BigInt(r.permissions),
                hoist: r.hoist, mentionable: r.mentionable, reason,
            });
            roles++;
        } catch { /* yut */ }
    }

    // Kategoriler once.
    const haveCh = new Set(guild.channels.cache.map(c => c.name));
    const newCat = {}; // oldId -> new channel
    for (const c of snap.channels.filter(c => c.type === ChannelType.GuildCategory && !haveCh.has(c.name))) {
        try {
            newCat[c.id] = await guild.channels.create({
                name: c.name, type: ChannelType.GuildCategory, position: c.position, reason,
            });
            channels++;
        } catch { /* yut */ }
    }

    // Sonra text / announcement / forum.
    const KINDS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice];
    for (const c of snap.channels.filter(c => KINDS.includes(c.type) && !haveCh.has(c.name))) {
        try {
            let parent;
            if (c.parentId) {
                if (newCat[c.parentId]) parent = newCat[c.parentId].id;
                else if (guild.channels.cache.has(c.parentId)) parent = c.parentId;
                else {
                    const snapCat = snap.channels.find(x => x.id === c.parentId && x.type === ChannelType.GuildCategory);
                    const existing = snapCat && guild.channels.cache.find(x => x.name === snapCat.name && x.type === ChannelType.GuildCategory);
                    if (existing) parent = existing.id;
                }
            }
            await guild.channels.create({
                name: c.name, type: c.type,
                parent: parent || undefined,
                topic: c.topic || undefined,
                position: c.position, reason,
            });
            channels++;
        } catch { /* yut */ }
    }

    return { channels, roles, when };
}

module.exports = { restoreLatest };

// lib/antiraid/snapshot.js
// Sunucu yapisinin (kanallar + roller) anlik goruntusu. Ommy-Antiraid'deki
// snapshot ile ayni sema; restore bununla server'i geri kurar.

const AntiraidSnapshot = require('../../models/AntiraidSnapshot');

const MAX_PER_GUILD = 10;

async function takeSnapshot(guild, label = 'auto') {
    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const channels = guild.channels.cache.map(ch => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        parentId: ch.parentId ?? null,
        position: ch.position ?? 0,
        topic: ch.topic ?? null,
        permissionOverwrites: ch.permissionOverwrites?.cache?.map(ow => ({
            id: ow.id, type: ow.type,
            allow: ow.allow.bitfield.toString(),
            deny: ow.deny.bitfield.toString(),
        })) ?? [],
    }));

    const roles = guild.roles.cache
        .filter(r => !r.managed)
        .map(r => ({
            id: r.id, name: r.name, color: r.color,
            permissions: r.permissions.bitfield.toString(),
            hoist: r.hoist, mentionable: r.mentionable, position: r.position,
        }));

    const snap = await AntiraidSnapshot.create({
        guildId: guild.id, label,
        serverName: guild.name, serverIcon: guild.icon,
        channels, roles,
    });

    // Eski snapshotlari buda.
    const old = await AntiraidSnapshot.find({ guildId: guild.id })
        .sort({ createdAt: -1 }).skip(MAX_PER_GUILD).select('_id').lean();
    if (old.length) {
        await AntiraidSnapshot.deleteMany({ _id: { $in: old.map(o => o._id) } }).catch(() => {});
    }
    return snap;
}

async function latestSnapshot(guildId) {
    return AntiraidSnapshot.findOne({ guildId }).sort({ createdAt: -1 }).lean();
}

module.exports = { takeSnapshot, latestSnapshot };

const Jail = require('../models/Jail');
const perms = require('../lib/perms');
const { LEGACY_GUILD_ID } = require('../lib/legacySeed');

// GodMode: the bot operator can't be jailed, muted, timed out or banned.
//
// This ran in EVERY guild the bot was in. While the bot lived in one server
// that was the operator's own protection in his own server. Now that the bot
// can join any server, the same code would undo other servers' moderation:
// an admin elsewhere bans the operator and the bot unbans him, they time him
// out and the bot lifts it. That overrides a server's own decisions about its
// own members, which is exactly what a bot invited into it must not do.
//
// So it is confined to the home guild, where it behaves exactly as before.
// MOD_ROLE_ID is that guild's role and means nothing anywhere else.

module.exports = (client) => {

    const MOD_ROLE_ID = "1447144301305008168";

    const isHome = guild => !!guild && guild.id === LEGACY_GUILD_ID;

    //--------------------------------
    // READY: Başlangıçta jail temizle ve rol ver
    //--------------------------------
    client.on('ready', async () => {
        try {
            const guild = client.guilds.cache.get(LEGACY_GUILD_ID);
            if (!guild) return;

            for (const ownerId of perms.OWNER_IDS) {
                const member = await guild.members.fetch(ownerId).catch(() => null);
                if (!member) continue;

                // MongoDB'den hapis kaydı varsa rollerini geri ver
                const dbJail = await Jail.findOne({ userId: ownerId, guildId: guild.id });
                if (dbJail) {
                    if (dbJail.roles && dbJail.roles.length > 0) {
                        await member.roles.add(dbJail.roles).catch(() => {});
                    }
                    await Jail.deleteOne({ _id: dbJail._id });
                }

                // Jail rolünü kaldır
                const jailRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'jail');
                if (jailRole && member.roles.cache.has(jailRole.id)) {
                    await member.roles.remove(jailRole).catch(() => {});
                }

                // Mod rolünü ver
                if (!member.roles.cache.has(MOD_ROLE_ID)) {
                    await member.roles.add(MOD_ROLE_ID).catch(() => {});
                }

                // Timeout varsa kaldır
                if (member.isCommunicationDisabled()) await member.timeout(null).catch(() => {});
            }

            console.log("🟢 GodMode: Başlangıç temizlendi, koruma aktif (home guild only).");
        } catch (err) {
            console.error("GodMode Startup Error:", err);
        }
    });

    //--------------------------------
    // LIVE PROTECTION
    //--------------------------------
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!isHome(newMember.guild) || !perms.isOwner(newMember.id)) return;

        // Jail rolü varsa sil
        const jailRole = newMember.guild.roles.cache.find(r => r.name.toLowerCase() === 'jail');
        if (jailRole && newMember.roles.cache.has(jailRole.id)) {
            await newMember.roles.remove(jailRole).catch(() => {});
            console.log("🚫 GodMode: Jail silindi.");
        }

        // Mod rolü alınmışsa geri ver
        if (!newMember.roles.cache.has(MOD_ROLE_ID)) {
            await newMember.roles.add(MOD_ROLE_ID).catch(() => {});
            console.log("🛡️ GodMode: Mod rolü geri verildi.");
        }

        // Timeout/mute varsa kaldır
        if (newMember.isCommunicationDisabled()) {
            await newMember.timeout(null).catch(() => {});
            console.log("🚫 GodMode: Timeout kaldırıldı.");
        }
    });

    //--------------------------------
    // ANTI-BAN
    //--------------------------------
    client.on('guildBanAdd', async (ban) => {
        if (!isHome(ban.guild) || !perms.isOwner(ban.user.id)) return;
        await ban.guild.members.unban(ban.user.id).catch(() => {});
        console.log("🚨 GodMode: Ban iptal edildi!");
    });

    //--------------------------------
    // VOICE GUARD
    //--------------------------------
    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (!isHome(newState.guild) || !perms.isOwner(newState.id)) return;
        if (newState.serverMute || newState.serverDeaf) {
            await newState.setMute(false).catch(() => {});
            await newState.setDeaf(false).catch(() => {});
        }
    });

};

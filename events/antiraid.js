// events/antiraid.js
// Discord olaylarini antiraid motoruna baglar. Iki hot path:
//   - guildMemberAdd            -> join-raid penceresi
//   - guildAuditLogEntryCreate  -> nuke (kanal/rol silme, toplu ban) + fail tespiti
//
// Ayrica global-ban: motor kapali olsa bile, kesin raid hesaplari Chamy'nin
// oldugu HER sunucuda girer girmez atilir.

const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const engine = require('../lib/antiraid/engine');
const spam = require('../lib/antiraid/spam');
const configStore = require('../lib/antiraid/configStore');
const { takeSnapshot } = require('../lib/antiraid/snapshot');

// Nuke sayilan audit log aksiyonlari -> okunabilir etiket.
const DESTRUCTIVE = {
    [AuditLogEvent.ChannelDelete]: 'channel delete',
    [AuditLogEvent.RoleDelete]: 'role delete',
    [AuditLogEvent.ChannelCreate]: 'channel create', // nuke botlari spam kanal da acar
    [AuditLogEvent.MemberBanAdd]: 'ban',
    [AuditLogEvent.MemberKick]: 'kick',
    [AuditLogEvent.WebhookCreate]: 'webhook create',
};

module.exports = (client) => {
    // --- Join hot path + global ban ---
    client.on('guildMemberAdd', async (member) => {
        try {
            // Global ban: kesin raid hesabi her acik-korumali sunucuda aninda atilir.
            const globals = await configStore.globalBanSet();
            if (globals.has(member.id)) {
                const cfg = await configStore.get(member.guild.id);
                if (cfg.enabled &&
                    member.guild.members.me?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                    await member.ban({ reason: '[Chamy Antiraid] Known raid account (global ban)' })
                        .catch(() => {});
                    console.warn(`[ANTIRAID] global-ban hit: ${member.id} in ${member.guild.id}`);
                    return;
                }
            }
            await engine.onMemberJoin(member);
        } catch (err) {
            console.error('[ANTIRAID] guildMemberAdd:', err.message);
        }
    });

    // --- Mesaj spami hot path (xxx/scam link, calinmis hesap, sel, koordineli) ---
    client.on('messageCreate', (message) => {
        spam.onMessage(message).catch(err =>
            console.error('[ANTIRAID] spam:', err.message));
    });

    // --- Nuke hot path ---
    // Audit log girisi, silme/ban gibi eylemlerin KIM tarafindan yapildigini verir.
    // channelDelete/roleDelete event'lerinin aksine fail id'si burada var.
    client.on('guildAuditLogEntryCreate', async (entry, guild) => {
        try {
            const kind = DESTRUCTIVE[entry.action];
            if (!kind) return;
            const actorId = entry.executorId;
            if (!actorId || actorId === client.user.id) return; // Chamy'nin kendi islemleri
            await engine.onDestructiveAction(guild, actorId, kind);
        } catch (err) {
            console.error('[ANTIRAID] auditLogEntryCreate:', err.message);
        }
    });

    // --- Periyodik snapshot: korumasi acik sunucularin yapisini saatte bir kaydet ---
    // Restore icin guncel bir snapshot her zaman hazir olsun.
    async function snapshotEnabledGuilds() {
        for (const guild of client.guilds.cache.values()) {
            try {
                const cfg = await configStore.get(guild.id);
                if (cfg.enabled) await takeSnapshot(guild, 'auto');
            } catch { /* yut */ }
        }
    }
    client.once('ready', () => {
        // Acilisdan 1 dk sonra ilk snapshot, sonra saatte bir.
        setTimeout(snapshotEnabledGuilds, 60_000);
        setInterval(snapshotEnabledGuilds, 60 * 60 * 1000);
    });
};

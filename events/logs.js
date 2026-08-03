const { EmbedBuilder, AuditLogEvent, ChannelType } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

module.exports = (client) => {

    //--------------------------
    // PER-GUILD LOG CHANNEL (cached, configured via /setup logs)
    //--------------------------

    const logChannelCache = new Map(); // guildId -> channelId | null

    async function getLogChannelId(guildId) {
        if (logChannelCache.has(guildId)) return logChannelCache.get(guildId);
        const config = await GuildConfig.findOne({ guildId }).catch(() => null);
        const channelId = config?.logChannelId || null;
        logChannelCache.set(guildId, channelId);
        return channelId;
    }

    // Emitted by /setup logs whenever a guild's log channel changes
    client.on('logConfigUpdate', (guildId) => {
        logChannelCache.delete(guildId);
    });

    //--------------------------
    // SEND HELPER
    //--------------------------

    async function sendLog(embed, guildId) {
        const channelId = await getLogChannelId(guildId);
        if (!channelId) return; // logging not configured for this guild

        try {
            const ch = await client.channels.fetch(channelId);
            if (ch) await ch.send({ embeds: [embed] });
        } catch (e) {
            console.error('[LOGS] Send error:', e.message);
        }
    }

    // Audit log çekme yardımcısı — rate limit için kısa bekle
    async function getAuditEntry(guild, type, targetId, maxAge = 3000) {
        try {
            await new Promise(r => setTimeout(r, 500));
            const logs  = await guild.fetchAuditLogs({ type, limit: 5 });
            const entry = logs.entries.find(e =>
                (!targetId || e.target?.id === targetId) &&
                (Date.now() - e.createdTimestamp) < maxAge
            );
            return entry || null;
        } catch {
            return null;
        }
    }

    // Kanal tipi → okunabilir string
    function channelTypeName(type) {
        const map = {
            [ChannelType.GuildText]:         'Text',
            [ChannelType.GuildVoice]:        'Voice',
            [ChannelType.GuildCategory]:     'Category',
            [ChannelType.GuildAnnouncement]: 'Announcement',
            [ChannelType.GuildForum]:        'Forum',
            [ChannelType.GuildStageVoice]:   'Stage',
            [ChannelType.GuildDirectory]:    'Directory',
        };
        return map[type] || 'Unknown';
    }

    //--------------------------
    // 1. MESSAGE DELETED
    //--------------------------
    client.on('messageDelete', async (msg) => {
        if (!msg.guild || !msg.author || msg.author.bot) return;

        const entry = await getAuditEntry(msg.guild, AuditLogEvent.MessageDelete, msg.author.id);
        const deletedBy = entry ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'Self or Unknown';

        const embed = new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('🗑️ Message Deleted')
            .setThumbnail(msg.author.displayAvatarURL())
            .addFields(
                { name: 'Author',      value: `<@${msg.author.id}> (${msg.author.tag})`, inline: true },
                { name: 'Channel',     value: `<#${msg.channelId}>`,                     inline: true },
                { name: 'Deleted By',  value: deletedBy,                                 inline: true },
                { name: 'Message ID',  value: `\`${msg.id}\``,                           inline: true },
                { name: 'Created',     value: `<t:${Math.floor(msg.createdTimestamp / 1000)}:R>`, inline: true },
                {
                    name:  'Content',
                    value: msg.content?.slice(0, 1000) || '*No text content (embed/attachment)*',
                    inline: false
                }
            );

        if (msg.attachments.size > 0) {
            embed.addFields({
                name:  '📎 Attachments',
                value: msg.attachments.map(a => a.url).join('\n').slice(0, 500),
                inline: false
            });
        }

        embed.setTimestamp();
        await sendLog(embed, msg.guild.id);
    });

    //--------------------------
    // 2. MESSAGE EDITED
    //--------------------------
    client.on('messageUpdate', async (oldMsg, newMsg) => {
        // Restart sonrası cache boş olduğundan eski mesajların edit'inde
        // oldMsg partial gelir ve author null olur → null guard şart.
        const author = newMsg.author || oldMsg.author;
        const guild  = newMsg.guild  || oldMsg.guild;
        if (!guild || !author || author.bot) return;
        if (oldMsg.content === newMsg.content) return;

        const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('✏️ Message Edited')
            .setThumbnail(author.displayAvatarURL())
            .setURL(newMsg.url)
            .addFields(
                { name: 'Author',     value: `<@${author.id}> (${author.tag})`, inline: true },
                { name: 'Channel',   value: `<#${newMsg.channelId}>`,                         inline: true },
                { name: 'Message ID',value: `\`${newMsg.id}\``,                               inline: true },
                { name: '📤 Before', value: oldMsg.partial ? '*Unknown (not cached)*' : (oldMsg.content?.slice(0, 500) || '*None*'), inline: false },
                { name: '📥 After',  value: newMsg.content?.slice(0, 500) || '*None*',        inline: false }
            )
            .setTimestamp();

        await sendLog(embed, guild.id);
    });

    //--------------------------
    // 3. BULK MESSAGE DELETE
    //--------------------------
    client.on('messageDeleteBulk', async (messages, channel) => {
        if (!channel.guild) return;

        const entry = await getAuditEntry(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🗑️ Bulk Message Delete')
            .addFields(
                { name: 'Channel',    value: `<#${channel.id}>`,                                         inline: true },
                { name: 'Count',      value: `\`${messages.size}\` messages`,                            inline: true },
                { name: 'Deleted By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',              inline: true }
            )
            .setTimestamp();

        await sendLog(embed, channel.guild.id);
    });

    //--------------------------
    // 4. MEMBER JOIN
    //--------------------------
    client.on('guildMemberAdd', async (member) => {
        const accountAge = Date.now() - member.user.createdTimestamp;
        const isNew      = accountAge < 7 * 24 * 60 * 60 * 1000; // 7 gün

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('📥 Member Joined')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User',            value: `<@${member.id}> (${member.user.tag})`,                  inline: true },
                { name: 'User ID',         value: `\`${member.id}\``,                                      inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Bot?',            value: member.user.bot ? 'Yes 🤖' : 'No',                        inline: true },
                { name: 'Server Members', value: `\`${member.guild.memberCount}\``,                         inline: true },
                { name: '⚠️ New Account?', value: isNew ? '**Yes — account under 7 days old!**' : 'No',   inline: true }
            )
            .setTimestamp();

        await sendLog(embed, member.guild.id);
    });

    //--------------------------
    // 5. MEMBER LEAVE / KICK
    //--------------------------
    client.on('guildMemberRemove', async (member) => {
        const entry   = await getAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
        const wasKick = !!entry;

        const roles = member.roles.cache
            .filter(r => r.id !== member.guild.id)
            .map(r => `<@&${r.id}>`)
            .join(', ') || 'None';

        const embed = new EmbedBuilder()
            .setColor(wasKick ? 0xff6600 : 0x888888)
            .setTitle(wasKick ? '👢 Member Kicked' : '📤 Member Left')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User',     value: `<@${member.id}> (${member.user.tag})`, inline: true },
                { name: 'User ID',  value: `\`${member.id}\``,                     inline: true },
                { name: 'Roles',    value: roles.slice(0, 500),                    inline: false }
            );

        if (wasKick) {
            embed.addFields(
                { name: 'Kicked By', value: `<@${entry.executor.id}> (${entry.executor.tag})`, inline: true },
                { name: 'Reason',    value: entry.reason || 'No reason provided',              inline: true }
            );
        }

        embed.setTimestamp();
        await sendLog(embed, member.guild.id);
    });

    //--------------------------
    // 6. BAN
    //--------------------------
    client.on('guildBanAdd', async (ban) => {
        const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

        const embed = new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🔨 Member Banned')
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: 'User',      value: `<@${ban.user.id}> (${ban.user.tag})`,                    inline: true },
                { name: 'User ID',   value: `\`${ban.user.id}\``,                                     inline: true },
                { name: 'Banned By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',            inline: true },
                { name: 'Reason',    value: ban.reason || entry?.reason || 'No reason provided',      inline: false }
            )
            .setTimestamp();

        await sendLog(embed, ban.guild.id);
    });

    //--------------------------
    // 7. UNBAN
    //--------------------------
    client.on('guildBanRemove', async (ban) => {
        const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

        const embed = new EmbedBuilder()
            .setColor(0x00cc44)
            .setTitle('✅ Member Unbanned')
            .addFields(
                { name: 'User',       value: `<@${ban.user.id}> (${ban.user.tag})`, inline: true },
                { name: 'User ID',    value: `\`${ban.user.id}\``,                  inline: true },
                { name: 'Unbanned By',value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true }
            )
            .setTimestamp();

        await sendLog(embed, ban.guild.id);
    });

    //--------------------------
    // 8. TIMEOUT (mute)
    //--------------------------
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        const wasTimedOut  = oldMember.communicationDisabledUntilTimestamp;
        const isTimedOut   = newMember.communicationDisabledUntilTimestamp;
        const roleAdded    = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const roleRemoved  = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
        const nicknameChanged = oldMember.nickname !== newMember.nickname;

        // Timeout applied
        if (!wasTimedOut && isTimedOut) {
            const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
            const embed = new EmbedBuilder()
                .setColor(0xff8800)
                .setTitle('⏱️ Member Timed Out')
                .addFields(
                    { name: 'User',        value: `<@${newMember.id}> (${newMember.user.tag})`,            inline: true },
                    { name: 'Timed Out By',value: entry ? `<@${entry.executor.id}>` : 'Unknown',           inline: true },
                    { name: 'Until',       value: `<t:${Math.floor(isTimedOut / 1000)}:F>`,                inline: true },
                    { name: 'Reason',      value: entry?.reason || 'No reason provided',                   inline: false }
                )
                .setTimestamp();
            await sendLog(embed, newMember.guild.id);
        }

        // Timeout removed
        if (wasTimedOut && !isTimedOut) {
            const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
            const embed = new EmbedBuilder()
                .setColor(0x00cc44)
                .setTitle('✅ Timeout Removed')
                .addFields(
                    { name: 'User',       value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true },
                    { name: 'Removed By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true }
                )
                .setTimestamp();
            await sendLog(embed, newMember.guild.id);
        }

        // Role changes
        if (roleAdded.size > 0 || roleRemoved.size > 0) {
            const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
            const embed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('🎭 Member Roles Updated')
                .addFields(
                    { name: 'User',       value: `<@${newMember.id}> (${newMember.user.tag})`,                            inline: true },
                    { name: 'Updated By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',                           inline: true }
                );

            if (roleAdded.size > 0)   embed.addFields({ name: '➕ Roles Added',   value: roleAdded.map(r => `<@&${r.id}>`).join(', '),   inline: false });
            if (roleRemoved.size > 0) embed.addFields({ name: '➖ Roles Removed', value: roleRemoved.map(r => `<@&${r.id}>`).join(', '), inline: false });

            embed.setTimestamp();
            await sendLog(embed, newMember.guild.id);
        }

        // Nickname change
        if (nicknameChanged) {
            const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('📝 Nickname Changed')
                .addFields(
                    { name: 'User',       value: `<@${newMember.id}> (${newMember.user.tag})`,         inline: true },
                    { name: 'Changed By', value: entry ? `<@${entry.executor.id}>` : 'Self/Unknown',   inline: true },
                    { name: '📤 Before',  value: oldMember.nickname || '*None*',                        inline: true },
                    { name: '📥 After',   value: newMember.nickname || '*None*',                        inline: true }
                )
                .setTimestamp();
            await sendLog(embed, newMember.guild.id);
        }
    });

    //--------------------------
    // 9. CHANNEL CREATED
    //--------------------------
    client.on('channelCreate', async (channel) => {
        if (!channel.guild) return;

        const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

        const embed = new EmbedBuilder()
            .setColor(0x00d2ff)
            .setTitle('📁 Channel Created')
            .addFields(
                { name: 'Name',       value: `<#${channel.id}> (#${channel.name})`, inline: true },
                { name: 'Type',       value: channelTypeName(channel.type),          inline: true },
                { name: 'Category',   value: channel.parent?.name || 'None',        inline: true },
                { name: 'Created By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true }
            )
            .setTimestamp();

        await sendLog(embed, channel.guild.id);
    });

    //--------------------------
    // 10. CHANNEL DELETED
    //--------------------------
    client.on('channelDelete', async (channel) => {
        if (!channel.guild) return;

        const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

        const embed = new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('🗑️ Channel Deleted')
            .addFields(
                { name: 'Name',       value: `#${channel.name}`,                     inline: true },
                { name: 'Type',       value: channelTypeName(channel.type),          inline: true },
                { name: 'Category',   value: channel.parent?.name || 'None',        inline: true },
                { name: 'Deleted By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true }
            )
            .setTimestamp();

        await sendLog(embed, channel.guild.id);
    });

    //--------------------------
    // 11. CHANNEL UPDATED
    //--------------------------
    client.on('channelUpdate', async (oldCh, newCh) => {
        if (!newCh.guild) return;

        const changes = [];
        if (oldCh.name  !== newCh.name)  changes.push({ name: 'Name',  before: oldCh.name,  after: newCh.name });
        if (oldCh.topic !== newCh.topic) changes.push({ name: 'Topic', before: oldCh.topic || 'None', after: newCh.topic || 'None' });
        if ((oldCh.rateLimitPerUser ?? 0) !== (newCh.rateLimitPerUser ?? 0)) {
            changes.push({ name: 'Slowmode', before: `${oldCh.rateLimitPerUser}s`, after: `${newCh.rateLimitPerUser}s` });
        }
        if (!changes.length) return;

        const entry = await getAuditEntry(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);

        const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('✏️ Channel Updated')
            .addFields(
                { name: 'Channel',    value: `<#${newCh.id}>`,                              inline: true },
                { name: 'Updated By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true },
                ...changes.map(c => ({ name: c.name, value: `**Before:** ${c.before}\n**After:** ${c.after}`, inline: false }))
            )
            .setTimestamp();

        await sendLog(embed, newCh.guild.id);
    });

    //--------------------------
    // 12. ROLE CREATED
    //--------------------------
    client.on('roleCreate', async (role) => {
        const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);

        const embed = new EmbedBuilder()
            .setColor(role.color || 0x99aab5)
            .setTitle('🎭 Role Created')
            .addFields(
                { name: 'Role',       value: `<@&${role.id}> (${role.name})`, inline: true },
                { name: 'Color',      value: role.hexColor,                   inline: true },
                { name: 'Hoisted',    value: role.hoist ? 'Yes' : 'No',       inline: true },
                { name: 'Mentionable',value: role.mentionable ? 'Yes' : 'No', inline: true },
                { name: 'Created By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true }
            )
            .setTimestamp();

        await sendLog(embed, role.guild.id);
    });

    //--------------------------
    // 13. ROLE DELETED
    //--------------------------
    client.on('roleDelete', async (role) => {
        const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);

        const embed = new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('🗑️ Role Deleted')
            .addFields(
                { name: 'Role',       value: role.name,                                            inline: true },
                { name: 'Color',      value: role.hexColor,                                        inline: true },
                { name: 'Deleted By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',       inline: true }
            )
            .setTimestamp();

        await sendLog(embed, role.guild.id);
    });

    //--------------------------
    // 14. ROLE UPDATED
    //--------------------------
    client.on('roleUpdate', async (oldRole, newRole) => {
        const changes = [];
        if (oldRole.name  !== newRole.name)  changes.push({ name: 'Name',  before: oldRole.name,     after: newRole.name });
        if (oldRole.color !== newRole.color) changes.push({ name: 'Color', before: oldRole.hexColor, after: newRole.hexColor });
        if (oldRole.hoist !== newRole.hoist) changes.push({ name: 'Hoisted', before: String(oldRole.hoist), after: String(newRole.hoist) });
        if (!changes.length) return;

        const entry = await getAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('✏️ Role Updated')
            .addFields(
                { name: 'Role',       value: `<@&${newRole.id}>`,                           inline: true },
                { name: 'Updated By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true },
                ...changes.map(c => ({ name: c.name, value: `**Before:** ${c.before}\n**After:** ${c.after}`, inline: false }))
            )
            .setTimestamp();

        await sendLog(embed, newRole.guild.id);
    });

    //--------------------------
    // 15. VOICE STATE UPDATE
    //--------------------------
    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (oldState.channelId === newState.channelId) return; // mute/deafen değişikliklerini ignore et

        let title, color;
        let fields = [{ name: 'User', value: `<@${newState.member.id}> (${newState.member.user.tag})`, inline: true }];

        if (!oldState.channelId && newState.channelId) {
            title = '🎙️ Joined Voice';
            color = 0x00cc44;
            fields.push({ name: 'Channel', value: `<#${newState.channelId}>`, inline: true });
        } else if (oldState.channelId && !newState.channelId) {
            title = '🔇 Left Voice';
            color = 0x888888;
            fields.push({ name: 'Channel', value: `<#${oldState.channelId}>`, inline: true });
        } else {
            title = '🔀 Switched Voice';
            color = 0xffa500;
            fields.push(
                { name: 'From', value: `<#${oldState.channelId}>`, inline: true },
                { name: 'To',   value: `<#${newState.channelId}>`, inline: true }
            );
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .addFields(fields)
            .setTimestamp();

        await sendLog(embed, newState.guild.id);
    });

    //--------------------------
    // 16. INVITE CREATED
    //--------------------------
    client.on('inviteCreate', async (invite) => {
        if (!invite.guild) return;

        const embed = new EmbedBuilder()
            .setColor(0x00d2ff)
            .setTitle('🔗 Invite Created')
            .addFields(
                { name: 'Created By', value: `<@${invite.inviter?.id}> (${invite.inviter?.tag || 'Unknown'})`, inline: true },
                { name: 'Channel',    value: invite.channel ? `<#${invite.channel.id}>` : 'Unknown',           inline: true },
                { name: 'Code',       value: `\`${invite.code}\``,                                             inline: true },
                { name: 'Max Uses',   value: `\`${invite.maxUses || 'Unlimited'}\``,                           inline: true },
                { name: 'Expires',    value: invite.expiresAt ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never', inline: true },
                { name: 'Temporary',  value: invite.temporary ? 'Yes' : 'No',                                  inline: true }
            )
            .setTimestamp();

        await sendLog(embed, invite.guild.id);
    });

    //--------------------------
    // 17. EMOJI CREATED / DELETED
    //--------------------------
    client.on('emojiCreate', async (emoji) => {
        const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('😀 Emoji Created')
            .setThumbnail(emoji.url)
            .addFields(
                { name: 'Name',       value: `:${emoji.name}:`,                                     inline: true },
                { name: 'ID',         value: `\`${emoji.id}\``,                                     inline: true },
                { name: 'Created By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',         inline: true }
            )
            .setTimestamp();
        await sendLog(embed, emoji.guild.id);
    });

    client.on('emojiDelete', async (emoji) => {
        const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
        const embed = new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('🗑️ Emoji Deleted')
            .addFields(
                { name: 'Name',       value: `:${emoji.name}:`,                                     inline: true },
                { name: 'Deleted By', value: entry ? `<@${entry.executor.id}>` : 'Unknown',         inline: true }
            )
            .setTimestamp();
        await sendLog(embed, emoji.guild.id);
    });

    //--------------------------
    // 18. SERVER UPDATED
    //--------------------------
    client.on('guildUpdate', async (oldGuild, newGuild) => {
        const changes = [];
        if (oldGuild.name              !== newGuild.name)              changes.push({ name: 'Name',            before: oldGuild.name,              after: newGuild.name });
        if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push({ name: 'Verification',    before: String(oldGuild.verificationLevel), after: String(newGuild.verificationLevel) });
        if (oldGuild.ownerId           !== newGuild.ownerId)           changes.push({ name: 'Owner',           before: `<@${oldGuild.ownerId}>`,   after: `<@${newGuild.ownerId}>` });
        if (!changes.length) return;

        const entry = await getAuditEntry(newGuild, AuditLogEvent.GuildUpdate);

        const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('⚙️ Server Updated')
            .addFields(
                { name: 'Updated By', value: entry ? `<@${entry.executor.id}>` : 'Unknown', inline: true },
                ...changes.map(c => ({ name: c.name, value: `**Before:** ${c.before}\n**After:** ${c.after}`, inline: false }))
            )
            .setTimestamp();

        await sendLog(embed, newGuild.id);
    });
};

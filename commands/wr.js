// commands/wr.js
// /wr sync  -> bir WR kanalini tarar, guncel dunya rekorlarini veritabanina kaydeder
// /wr show  -> bir pistin kayitli WR'lerini gosterir

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../lib/perms');
const { syncWorldRecords, findTrackRecords } = require('../services/worldRecords');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wr')
        .setDescription('Madcar world records')
        .addSubcommand(s => s
            .setName('sync')
            .setDescription('Scan a world-record channel and save the current WRs')
            .addStringOption(o => o
                .setName('channel')
                .setDescription('Channel ID or #mention (default: this channel)')))
        .addSubcommand(s => s
            .setName('show')
            .setDescription('Show saved world records for a track')
            .addStringOption(o => o
                .setName('track')
                .setDescription('Track name, e.g. Monza, Nuremberg (R), Lusail')
                .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'sync') {
            const allowed = perms.isOwner(interaction.user.id) ||
                interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
            if (!allowed) {
                return interaction.reply({ content: '❌ Only server managers can sync world records.', ephemeral: true });
            }

            const raw = interaction.options.getString('channel') || '';
            const channelId = raw.match(/\d{15,21}/)?.[0] || interaction.channelId;

            await interaction.deferReply();
            const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased?.() || !channel.messages) {
                return interaction.editReply(`❌ I can't read <#${channelId}> — check that I'm in that server and can see the channel.`);
            }

            try {
                const r = await syncWorldRecords(channel);
                require('../services/recordsSync').pushRecords()
                    .catch(err => console.error('[WR PUSH]', err.message));
                if (!r.tracks) {
                    return interaction.editReply(`⚠️ No world records found in <#${channel.id}>.`);
                }
                const embed = new EmbedBuilder()
                    .setColor(0x00E676)
                    .setTitle('🏁 World records synced')
                    .setDescription([
                        `**${r.tracks}** tracks · **${r.records}** records from <#${channel.id}>`,
                        r.ultimate ? `Madcar Ultimate: ${r.ultimate} tracks (kept separate)` : null,
                        r.unmatched.length ? `Not in Mad+ yet: ${r.unmatched.join(', ')}` : null,
                        `Newest update in the channel: <t:${Math.floor(r.latestAt.getTime() / 1000)}:R>`,
                    ].filter(Boolean).join('\n'))
                    .setFooter({ text: 'Use /wr show track:<name> to check a track' });
                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error('[WR SYNC]', err);
                return interaction.editReply(`❌ Sync failed: ${err.message}`);
            }
        }

        if (sub === 'show') {
            const query = interaction.options.getString('track');
            const found = await findTrackRecords(query);
            if (!found.length) {
                return interaction.reply({ content: `❌ No saved records for "${query}". Run /wr sync first.`, ephemeral: true });
            }
            const embeds = found.slice(0, 3).map(t => new EmbedBuilder()
                .setColor(t.game === 'madcar' ? 0x00E676 : 0x8B5CF6)
                .setTitle(`🏁 ${t.trackName}${t.game === 'madcar-ultimate' ? ' · Madcar Ultimate' : ''}`)
                .setDescription(t.records.map(r =>
                    `**${r.carClass}**${r.note ? ` (${r.note})` : ''} — \`${r.time}\` · ${r.holderId ? `<@${r.holderId}>` : r.holderName}`,
                ).join('\n'))
                .setFooter({ text: `Synced ${t.syncedAt ? new Date(t.syncedAt).toISOString().slice(0, 10) : '?'}` }));
            return interaction.reply({ embeds, allowedMentions: { parse: [] } });
        }
    },
};

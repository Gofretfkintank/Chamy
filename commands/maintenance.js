const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Maintenance = require('../models/Maintenance');
const perms = require('../lib/perms');
const cfg   = require('../lib/guildConfig');
const { LEGACY_GUILD_ID } = require('../lib/legacySeed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Toggle maintenance mode.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option
                .setName('duration')
                .setDescription('Estimated maintenance duration (e.g. 30m, 1h, 2h30m). Optional.')
                .setRequired(false)
        ),

    async execute(interaction) {

        //--------------------------
        // PERMISSION CHECK
        //--------------------------

        // Maintenance mode is ONE switch for the whole bot: it locks commands in
        // every server at once. "Administrator here" was enough while the bot
        // lived in one server; open to any server, it would let any server's
        // admin lock the bot for everybody. So it is the operator, plus the home
        // server's admins, who always had it.
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isOperator  = perms.isOwner(interaction.user.id);
        const isHomeAdmin = interaction.guildId === LEGACY_GUILD_ID &&
            member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isOperator && !isHomeAdmin) {
            return interaction.reply({
                content: '❌ Maintenance mode affects the bot in every server, so only its operator can toggle it.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        //--------------------------
        // CURRENT STATE
        //--------------------------

        let state = await Maintenance.findById('singleton');

        //--------------------------
        // START MAINTENANCE
        //--------------------------

        if (!state || !state.active) {

            // Parse optional duration input
            const durationInput = interaction.options.getString('duration');
            const estimatedMinutes = durationInput ? parseDuration(durationInput) : null;

            if (durationInput && estimatedMinutes === null) {
                return interaction.editReply({
                    content: '❌ Invalid duration format. Use formats like `30m`, `1h`, or `2h30m`.',
                });
            }

            // Take a hash snapshot of all current commands
            const snapshot = {};
            for (const [name, cmd] of interaction.client.commands) {
                snapshot[name] = hashCommand(cmd);
            }

            if (!state) {
                state = new Maintenance({ _id: 'singleton' });
            }

            state.active           = true;
            state.snapshot         = snapshot;
            state.lockedCommands   = [];
            state.startedBy        = interaction.user.id;
            state.startedAt        = new Date();
            state.estimatedMinutes = estimatedMinutes;
            await state.save();

            // Build the private staff reply embed
            const staffEmbed = new EmbedBuilder()
                .setColor(0xe67e22)
                .setTitle('🔧 Maintenance Mode Enabled')
                .setDescription(
                    `The bot is now in maintenance mode.\n\n` +
                    `A snapshot of **${Object.keys(snapshot).length}** commands has been saved.\n` +
                    `Changed or newly added commands will be automatically locked after a redeploy.`
                )
                .addFields(
                    { name: 'Started By', value: `<@${interaction.user.id}>` },
                    ...(estimatedMinutes
                        ? [{ name: 'Estimated Duration', value: formatDuration(estimatedMinutes) }]
                        : []
                    )
                )
                .setFooter({ text: 'Dev team is working 🔧' })
                .setTimestamp();

            await interaction.editReply({ embeds: [staffEmbed] });

            // Send public announcement
            await sendMaintenanceAnnouncement(interaction.guild, estimatedMinutes, true);

            return;
        }

        //--------------------------
        // END MAINTENANCE
        //--------------------------

        const lockedList = state.lockedCommands.length > 0
            ? state.lockedCommands.map(c => `\`/${c}\``).join(', ')
            : 'No commands were locked.';

        state.active           = false;
        state.snapshot         = {};
        state.lockedCommands   = [];
        state.startedBy        = null;
        state.startedAt        = null;
        state.estimatedMinutes = null;
        await state.save();

        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('✅ Maintenance Mode Disabled')
            .setDescription(
                `Maintenance mode has ended. All commands are active again.\n\n` +
                `**Commands that were in maintenance:** ${lockedList}`
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Send public announcement that maintenance ended
        await sendMaintenanceAnnouncement(interaction.guild, null, false);
    }
};

//--------------------------
// ANNOUNCEMENT HELPER
// Sends a public embed to the announcements channel
//--------------------------

async function sendMaintenanceAnnouncement(guild, estimatedMinutes, isStart) {
    try {
        const channelId = await cfg.get(guild.id, 'channels:announcements');
        if (!channelId) return;
        const channel = guild.channels.cache.get(channelId)
            || await guild.channels.fetch(channelId).catch(() => null);

        if (!channel) return;

        let embed;

        if (isStart) {
            const durationLine = estimatedMinutes
                ? `⏱️ **Estimated Duration:** ${formatDuration(estimatedMinutes)}`
                : null;

            embed = new EmbedBuilder()
                .setColor(0xe67e22)
                .setTitle('🔧 Bot Maintenance')
                .setDescription(
                    [
                        `The dev team is currently working on the bot. Some updates or improvements are being applied.`,
                        durationLine,
                        ``,
                        `✅ **You can continue using the bot normally.**`,
                        `If a command you're trying to use is currently under maintenance, the bot will notify you automatically.`
                    ].filter(line => line !== null).join('\n')
                )
                .setFooter({ text: 'Dev Team' })
                .setTimestamp();
        } else {
            embed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('✅ Maintenance Complete')
                .setDescription(
                    `All systems are back online. The bot is fully operational.\n\n` +
                    `Thank you for your patience!`
                )
                .setFooter({ text: 'Dev Team' })
                .setTimestamp();
        }

        await channel.send({ embeds: [embed] });

    } catch (err) {
        console.error('[maintenance] Failed to send announcement:', err);
    }
}

//--------------------------
// DURATION PARSER
// Parses strings like "30m", "1h", "2h30m" → total minutes
// Returns null if format is invalid
//--------------------------

function parseDuration(input) {
    const str = input.trim().toLowerCase();
    const regex = /^(?:(\d+)h)?(?:(\d+)m)?$/;
    const match = str.match(regex);

    if (!match || (!match[1] && !match[2])) return null;

    const hours   = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const total   = hours * 60 + minutes;

    return total > 0 ? total : null;
}

//--------------------------
// DURATION FORMATTER
// Converts minutes to human-readable string
// e.g. 90 → "1 hour 30 minutes"
//--------------------------

function formatDuration(minutes) {
    if (!minutes) return 'Unknown';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const parts = [];
    if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
    return parts.join(' ');
}

//--------------------------
// HASH HELPER
// Converts command content (data JSON) to a string
// Used to detect if a command was changed after a redeploy
//--------------------------

function hashCommand(cmd) {
    try {
        return JSON.stringify(cmd.data.toJSON());
    } catch {
        return String(cmd.data.name);
    }
}

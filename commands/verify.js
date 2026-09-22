// commands/verify.js
//
// Sets up a verification gate in the channel this command is run in:
//   - Creates a "👤┃Member" role (baby blue, hoisted) if it doesn't exist yet
//   - Hides @everyone's view of every OTHER channel (unless already private)
//   - Grants the new role explicit view access to everything it just hid,
//     so verified members see exactly what they'd normally see
//   - Posts an embed + Verify button in this channel
//
// Clicking the button hands out the role. Channels that already had
// @everyone explicitly denied (own overwrite OR inherited from their
// category) are left completely untouched — this only gates channels
// that were previously open to everyone.

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const GuildConfig = require('../models/GuildConfig');

const MEMBER_ROLE_NAME  = '👤┃Member';
const MEMBER_ROLE_COLOR = '#89CFF0'; // baby blue

//--------------------------------------------------
// HELPERS
//--------------------------------------------------

function buildVerifyEmbed(guildName) {
    return new EmbedBuilder()
        .setColor(0x89CFF0)
        .setTitle('🔐 Server Verification')
        .setDescription(
            `Welcome to **${guildName}**!\n\n` +
            `Click **Verify** below to confirm you're human and unlock access to the rest of the server.`
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Verification System' })
        .setTimestamp();
}

function buildVerifyRow(roleId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_claim_${roleId}`)
            .setLabel('Verify')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
    );
}

// True if @everyone effectively can't see this channel — checked via the
// FULLY RESOLVED permission (base role perms + category + channel
// overwrites), not just an explicit deny overwrite. Catches channels
// hidden because @everyone's base role lacks ViewChannel, which the old
// overwrite-only check missed — that bug caused /verify to grant the new
// Member role view access to genuinely private (admin-only) channels.
function everyoneAlreadyDenied(channel, everyoneRole) {
    const resolved = channel.permissionsFor(everyoneRole);
    return !resolved || !resolved.has(PermissionFlagsBits.ViewChannel);
}

//--------------------------------------------------
// EXPORT
//--------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Set up the server verification gate in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName('role')
            .setDescription('Use this existing role instead of creating "Member" — e.g. a VSR role.')
            .setRequired(false)),

    //--------------------------------------------------
    // EXECUTE
    //--------------------------------------------------

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Hard in-code gate: setDefaultMemberPermissions is only a Discord-side
        // default that server admins can override in Integrations settings, and
        // some clients show restricted commands anyway. This check runs on OUR
        // side on every invocation — non-admins get rejected no matter what.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ This command is **admin-only**.');
        }

        const guild       = interaction.guild;
        const gateChannel = interaction.channel;
        const everyoneId  = guild.roles.everyone.id;
        const me          = guild.members.me;

        if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply('❌ I need **Manage Roles** and **Manage Channels** permission to set this up.');
        }

        // 1. Find or create the Member role
        let memberRole = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
        if (!memberRole) {
            memberRole = await guild.roles.create({
                name: MEMBER_ROLE_NAME,
                color: MEMBER_ROLE_COLOR,
                hoist: true,
                reason: 'OM Verify system setup'
            });
        }

        if (memberRole.position >= me.roles.highest.position) {
            return interaction.editReply(
                `⚠️ I created/found **${memberRole.name}**, but it sits **above or equal to** my highest role, ` +
                `so I won't be able to hand it out. Move my role above it in Server Settings → Roles, then run **/verify** again ` +
                `or just have people click the button once it's fixed.`
            );
        }

        // 2. Remember the setup in GuildConfig (per-guild, upsert)
        await GuildConfig.findOneAndUpdate(
            { guildId: guild.id },
            { verifyRoleId: memberRole.id, verifyChannelId: gateChannel.id },
            { upsert: true }
        ).catch(() => {});

        // 3. Guarantee the gate channel itself stays visible to @everyone,
        //    even if its category ends up locked below.
        await gateChannel.permissionOverwrites.edit(everyoneId, { ViewChannel: true }).catch(() => {});

        // 4. Sweep every other channel/category
        let locked = 0, skipped = 0, failed = 0;

        for (const channel of guild.channels.cache.values()) {
            if (channel.id === gateChannel.id) continue;

            try {
                if (everyoneAlreadyDenied(channel, guild.roles.everyone)) {
                    skipped++;
                    continue;
                }
                await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false });
                await channel.permissionOverwrites.edit(memberRole.id, { ViewChannel: true });
                locked++;
            } catch (err) {
                failed++;
                console.error(`[VERIFY] ${channel.name}:`, err.message);
            }
        }

        // 5. Post the public verify panel in the gate channel
        await gateChannel.send({
            embeds: [buildVerifyEmbed(guild.name)],
            components: [buildVerifyRow(memberRole.id)]
        });

        // 6. Confirm to the admin
        return interaction.editReply(
            `✅ Verification gate live in ${gateChannel}.\n\n` +
            `**Role:** ${memberRole} (baby blue, hoisted)\n` +
            `🔒 **${locked}** channel(s) hidden from @everyone\n` +
            `⏭️ **${skipped}** channel(s) already private — left untouched\n` +
            (failed ? `⚠️ **${failed}** channel(s) failed — check my permissions there.\n` : '') +
            `\nNew channels created later won't auto-lock — say the word if you want that too.`
        );
    },

    //--------------------------------------------------
    // BUTTON HANDLER — verify_claim_<roleId>
    //--------------------------------------------------

    async buttonHandler(interaction) {
        const roleId = interaction.customId.replace('verify_claim_', '');
        const role   = interaction.guild.roles.cache.get(roleId);

        if (!role) {
            return interaction.reply({ content: '❌ Verification role no longer exists — contact an admin.', ephemeral: true });
        }

        if (interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({ content: '✅ You\'re already verified!', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (role.position >= me.roles.highest.position) {
            return interaction.reply({
                content: '❌ I can\'t hand out this role right now — my role needs to be moved above it. Contact an admin.',
                ephemeral: true
            });
        }

        try {
            await interaction.member.roles.add(role, 'Self-verify via /verify button');
            return interaction.reply({
                content: `✅ Verified! You now have access to **${interaction.guild.name}**.`,
                ephemeral: true
            });
        } catch (err) {
            console.error('[VERIFY BUTTON]', err.message);
            return interaction.reply({ content: '❌ Something went wrong assigning the role. Contact an admin.', ephemeral: true });
        }
    }
};

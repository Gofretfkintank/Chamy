const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const perms = require('../lib/perms');

function ok(desc)  { return new EmbedBuilder().setColor(0x2ecc71).setDescription(desc); }
function err(desc) { return new EmbedBuilder().setColor(0xe74c3c).setDescription(desc); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server.')
        .addUserOption(o => o.setName('target').setDescription('The member to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('The reason for the ban'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        await interaction.deferReply();
        const targetMember = interaction.options.getMember('target');
        const targetUser   = interaction.options.getUser('target');
        const reason       = interaction.options.getString('reason') || 'No reason provided';
        if (targetMember && !targetMember.bannable)
            return interaction.editReply({ embeds: [err('❌ I cannot ban this user.')] });
        try {
            await interaction.guild.members.ban(targetUser.id, { reason });
            await interaction.editReply({ embeds: [
                ok(`🛰️ **${targetUser.tag}** has been neutralized.\n**Reason:** ${reason}`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .setFooter({ text: `Banned by ${interaction.user.tag}` })
                    .setTimestamp()
            ]});
        } catch {
            await interaction.editReply({ embeds: [err('❌ I cannot ban this user.')] });
        }
    },

    async prefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
            return message.reply({ embeds: [err('❌ You need **Ban Members** permission.')] });
        const id = args[0]?.replace(/[<@!>]/g, '');
        if (!id) return message.reply({ embeds: [err('❌ Usage: `ban @user [reason]`')] });
        const targetMember = await message.guild.members.fetch(id).catch(() => null);
        const targetUser   = targetMember?.user ?? await message.client.users.fetch(id).catch(() => null);
        if (!targetUser) return message.reply({ embeds: [err('❌ User not found.')] });
        // Was the bot owner's id plus one server's co-owner role, written in
        // here directly. Both now come from perms: the owner is global, the
        // co-owner role is whatever THIS guild configured.
        const hasFullPower = await perms.hasFullPower(message.member);
        if (targetMember) {
            if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position)
                return message.reply({ embeds: [err('❌ I cannot ban this user due to role hierarchy.')] });
            if (targetMember.permissions.has(PermissionFlagsBits.ManageMessages) && !hasFullPower)
                return message.reply({ embeds: [err('❌ Only the server owner or a configured co-owner can ban staff members.')] });
        }
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await message.guild.members.ban(targetUser.id, { reason });
            return message.reply({ embeds: [
                ok(`🛰️ **${targetUser.tag}** has been neutralized.\n**Reason:** ${reason}`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .setFooter({ text: `Banned by ${message.author.tag}` })
                    .setTimestamp()
            ]});
        } catch {
            return message.reply({ embeds: [err('❌ Could not ban this user.')] });
        }
    }
};

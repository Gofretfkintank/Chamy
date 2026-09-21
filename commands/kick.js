const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const perms = require('../lib/perms');

function ok(desc)  { return new EmbedBuilder().setColor(0x2ecc71).setDescription(desc); }
function err(desc) { return new EmbedBuilder().setColor(0xe74c3c).setDescription(desc); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server.')
        .addUserOption(o => o.setName('target').setDescription('The member to kick').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.options.getMember('target');
        if (!user) return interaction.editReply({ embeds: [err('❌ This user is not in the server.')] });
        if (!user.kickable) return interaction.editReply({ embeds: [err('❌ I cannot kick this user.')] });
        await user.kick();
        await interaction.editReply({ embeds: [
            ok(`🔫 **${user.user.tag}** has been kicked from the server.`)
                .setThumbnail(user.user.displayAvatarURL())
                .setFooter({ text: `Kicked by ${interaction.user.tag}` })
                .setTimestamp()
        ]});
    },

    async prefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
            return message.reply({ embeds: [err('❌ You need **Kick Members** permission.')] });
        const id = args[0]?.replace(/[<@!>]/g, '');
        if (!id) return message.reply({ embeds: [err('❌ Usage: `kick @user`')] });
        const target = await message.guild.members.fetch(id).catch(() => null);
        if (!target) return message.reply({ embeds: [err('❌ Member not found in this server.')] });
        if (!target.kickable) return message.reply({ embeds: [err('❌ I cannot kick this user.')] });
        if (target.roles.highest.position >= message.guild.members.me.roles.highest.position)
            return message.reply({ embeds: [err('❌ I cannot kick this user due to role hierarchy.')] });
        // Global bot owner, server owner, or this guild's configured co-owner
        // role — previously one hardcoded user id and one hardcoded role id.
        const hasFullPower = await perms.hasFullPower(message.member);
        if (target.permissions.has(PermissionFlagsBits.ManageMessages) && !hasFullPower)
            return message.reply({ embeds: [err('❌ Only the server owner or a configured co-owner can kick staff members.')] });
        await target.kick();
        return message.reply({ embeds: [
            ok(`🔫 **${target.user.tag}** has been kicked from the server.`)
                .setThumbnail(target.user.displayAvatarURL())
                .setFooter({ text: `Kicked by ${message.author.tag}` })
                .setTimestamp()
        ]});
    }
};

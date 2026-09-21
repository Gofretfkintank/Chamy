//--------------------------
// IMPORTS
//--------------------------
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Jail  = require('../models/Jail');
const perms = require('../lib/perms');
const cfg   = require('../lib/guildConfig');

//--------------------------
// COMMAND
//--------------------------
module.exports = {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Quarantine a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('User to quarantine')
                .setRequired(true)
        ),

    async execute(interaction) {

        //--------------------------
        // PERMISSION CHECK
        //--------------------------
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You do not have permission.', ephemeral: true });
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: 'I cannot manage roles.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        //--------------------------
        // TARGET
        //--------------------------
        const targetUser = interaction.options.getUser('target');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) return interaction.editReply('User not found.');
        if (targetMember.id === interaction.user.id) return interaction.editReply('You cannot jail yourself.');

        //--------------------------
        // HIERARCHY CHECK + OPERATOR EXEMPTION
        //--------------------------
        // The bot operator skips the command's own hierarchy check. Discord still
        // enforces the bot's real role position when roles are set below, and the
        // Administrator check above still applies, so this is not a way around
        // either of those in somebody else's server.
        const isOperator = perms.isOwner(interaction.user.id);

        if (!isOperator && targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
            return interaction.editReply('You cannot act on this user.');
        }

        if (!isOperator && targetMember.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.editReply('Role hierarchy issue (bot cannot manage).');
        }

        //--------------------------
        // JAIL ROLE
        //--------------------------
        let jailRole = interaction.guild.roles.cache.find(r => r.name === 'Jail');

        if (!jailRole) {
            jailRole = await interaction.guild.roles.create({
                name: 'Jail',
                permissions: []
            });
        }

        //--------------------------
        // DATABASE CHECK
        //--------------------------
        const existing = await Jail.findOne({
            userId: targetMember.id,
            guildId: interaction.guildId
        });

        if (existing) {
            return interaction.editReply('User is already jailed.');
        }

        //--------------------------
        // PRESERVED ROLE
        //--------------------------
        // One role can survive jailing (in OM: a special moderator role). It used
        // to be a hardcoded id from that server; now each guild picks its own,
        // and a guild that picked none simply strips everything.
        const preservedRoleId = await cfg.get(interaction.guildId, 'staff:jailPreservedRole');

        //--------------------------
        // ROLE BACKUP (EXCEPT THE PRESERVED ROLE)
        //--------------------------
        const oldRoles = targetMember.roles.cache
            .filter(r =>
                r.id !== interaction.guild.id &&
                r.id !== jailRole.id &&
                r.id !== preservedRoleId
            )
            .map(r => r.id);

        await Jail.create({
            userId: targetMember.id,
            guildId: interaction.guildId,
            roles: oldRoles
        });

        //--------------------------
        // ROLE SET (CLEAN)
        //--------------------------
        const newRoles = [jailRole.id];

        if (preservedRoleId && targetMember.roles.cache.has(preservedRoleId)) {
            newRoles.push(preservedRoleId);
        }

        await targetMember.roles.set(newRoles);

        //--------------------------
        // DONE
        //--------------------------
        return interaction.editReply(`🔒 ${targetMember.user.tag} has been quarantined.`);
    }
};

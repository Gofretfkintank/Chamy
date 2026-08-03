// commands/wallet.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Economy = require('../models/Economy');

const SNOWFLAKE = /^\d{17,20}$/;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wallet')
        .setDescription('Shows your coin balance and stats.')
        .addUserOption(opt =>
            opt.setName('driver')
                .setDescription('Check another driver\'s wallet (optional)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('id')
                .setDescription('Look up by raw user ID — for drivers who left the server (optional)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const rawId     = interaction.options.getString('id');
        const driverOpt = interaction.options.getUser('driver');

        let targetId, targetUser;

        if (rawId) {
            if (!SNOWFLAKE.test(rawId)) {
                return interaction.reply({ content: '❌ That doesn\'t look like a valid user ID.', ephemeral: true });
            }
            targetId   = rawId;
            // Ayrılmış/silinmiş hesaplarda resolve olmayabilir — null'a düşer, alttaki fallback'ler devreye girer.
            targetUser = await interaction.client.users.fetch(rawId).catch(() => null);
        } else {
            targetUser = driverOpt ?? interaction.user;
            targetId   = targetUser.id;
        }

        const fallbackLabel = targetUser?.username ?? `Unknown user (${targetId})`;

        let wallet = await Economy.findOne({ userId: targetId });

        if (!wallet) {
            if (targetId === interaction.user.id) {
                // İlk kez sorgulanıyor → kayıt oluştur
                wallet = new Economy({ userId: targetId });
                await wallet.save();
            } else {
                return interaction.reply({
                    content: `❌ **${fallbackLabel}** hasn't earned anything yet.`,
                    ephemeral: true
                });
            }
        }

        const member      = await interaction.guild.members.fetch(targetId).catch(() => null);
        const displayName = member?.displayName ?? fallbackLabel;
        const avatarURL   = targetUser?.displayAvatarURL({ dynamic: true }) ?? interaction.client.user.displayAvatarURL();

        const embed = new EmbedBuilder()
            .setColor(0xf5c518)
            .setAuthor({
                name: `${displayName}'s Wallet`,
                iconURL: avatarURL
            })
            .addFields(
                { name: '🪙 Coins', value: `**${wallet.coins.toLocaleString()}**`, inline: true },
                { name: '💰 Max Money', value: `**${wallet.maxMoney.toLocaleString()}**`, inline: true },
                { name: '🏁 Arcane Level', value: `Lap **${wallet.level}**`, inline: true },
                { name: '✅ Correct Answers', value: `**${wallet.correctAnswers}**`, inline: true },
            )
            .setFooter({ text: 'OM Economy System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

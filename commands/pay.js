// commands/pay.js
// P2P Coin Transfer Command
// ─────────────────────────────────────────────────────────────────────────────
// /pay driver:@user amount:<n> → send coins from your wallet to another driver's wallet
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Economy = require('../models/Economy');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Send coins to another driver.')
        .addUserOption(opt =>
            opt.setName('driver')
                .setDescription('Who to send coins to')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('Amount of coins to send')
                .setRequired(true)
                .setMinValue(1)
        ),

    async execute(interaction) {
        const target = interaction.options.getUser('driver');
        const amount = interaction.options.getInteger('amount');

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You can\'t send coins to yourself.', ephemeral: true });
        }
        if (target.bot) {
            return interaction.reply({ content: '❌ You can\'t send coins to a bot.', ephemeral: true });
        }

        // Atomic guarded deduction: matches+decrements in one DB op so two rapid
        // /pay calls (or a retried interaction) can't double-spend the same balance,
        // and insufficient funds naturally just fail to match instead of going negative.
        const sender = await Economy.findOneAndUpdate(
            { userId: interaction.user.id, coins: { $gte: amount } },
            { $inc: { coins: -amount } },
            { new: true }
        );

        if (!sender) {
            const wallet = await Economy.findOne({ userId: interaction.user.id });
            const balance = wallet?.coins ?? 0;
            return interaction.reply({
                content: `❌ Insufficient balance. You have **${balance.toLocaleString()} 🪙**, need **${amount.toLocaleString()} 🪙**.`,
                ephemeral: true
            });
        }

        // Credit receiver directly (not addCoins) — a transfer isn't new
        // earnings, so totalEarned shouldn't inflate from moving money around.
        // maxMoney still updates since it tracks peak balance held, regardless of source.
        let receiver = await Economy.findOne({ userId: target.id });
        if (!receiver) receiver = new Economy({ userId: target.id });
        receiver.coins += amount;
        if (receiver.coins > receiver.maxMoney) receiver.maxMoney = receiver.coins;
        await receiver.save();

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        const displayName = member?.displayName ?? target.username;

        const embed = new EmbedBuilder()
            .setColor(0xf5c518)
            .setTitle('💸 Transfer Complete')
            .setDescription(`**${interaction.user.username}** sent coins to **${displayName}**.`)
            .addFields(
                { name: '🪙 Amount',           value: `**${amount.toLocaleString()}**`,       inline: true },
                { name: '💰 Your New Balance', value: `**${sender.coins.toLocaleString()}**`, inline: true }
            )
            .setFooter({ text: 'OM Economy System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

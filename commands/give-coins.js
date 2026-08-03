// commands/give-coins.js
// Admin Coin Management Command
// ─────────────────────────────────────────────────────────────────────────────
// /give-coins add   <amount> [driver|id] [reason]  → add coins
// /give-coins take  <amount> [driver|id] [reason]  → remove coins
// /give-coins set   <amount> [driver|id]           → set balance directly
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Economy = require('../models/Economy');

const SNOWFLAKE = /^\d{17,20}$/;

async function getWallet(userId) {
    let wallet = await Economy.findOne({ userId });
    if (!wallet) wallet = new Economy({ userId });
    return wallet;
}

function idOption(opt) {
    return opt.setName('id')
        .setDescription('Target by raw user ID instead of driver — for members who left (optional)')
        .setRequired(false);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give-coins')
        .setDescription('Admin: Manage driver coins.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // NOT: required option'lar (amount) her zaman optional'lardan (driver/id/reason) önce gelmeli — Discord şart koşuyor.
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add coins to a driver.')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of coins to add').setRequired(true).setMinValue(1))
                .addUserOption(opt => opt.setName('driver').setDescription('The driver (or use id)').setRequired(false))
                .addStringOption(idOption)
                .addStringOption(opt => opt.setName('reason').setDescription('Reason for adding (optional)'))
        )

        .addSubcommand(sub =>
            sub.setName('take')
                .setDescription('Remove coins from a driver.')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of coins to remove').setRequired(true).setMinValue(1))
                .addUserOption(opt => opt.setName('driver').setDescription('The driver (or use id)').setRequired(false))
                .addStringOption(idOption)
                .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing (optional)'))
        )

        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Directly set a driver\'s balance.')
                .addIntegerOption(opt => opt.setName('amount').setDescription('New balance amount').setRequired(true).setMinValue(0))
                .addUserOption(opt => opt.setName('driver').setDescription('The driver (or use id)').setRequired(false))
                .addStringOption(idOption)
        ),

    async execute(interaction) {
        const sub       = interaction.options.getSubcommand();
        const rawId     = interaction.options.getString('id');
        const driverOpt = interaction.options.getUser('driver');
        const amount    = interaction.options.getInteger('amount');
        const reason    = interaction.options.getString('reason') ?? 'Admin action';

        if (!rawId && !driverOpt) {
            return interaction.reply({ content: '❌ Specify either `driver` or `id`.', ephemeral: true });
        }
        if (rawId && !SNOWFLAKE.test(rawId)) {
            return interaction.reply({ content: '❌ That doesn\'t look like a valid user ID.', ephemeral: true });
        }

        let targetId, targetUser;
        if (rawId) {
            targetId   = rawId;
            // Ayrılmış/silinmiş hesaplarda resolve olmayabilir — economy işlemi yine de userId ile çalışır, sadece görünen isim fallback'e düşer.
            targetUser = await interaction.client.users.fetch(rawId).catch(() => null);
        } else {
            targetUser = driverOpt;
            targetId   = targetUser.id;
        }

        const fallbackLabel = targetUser?.username ?? `Unknown user (${targetId})`;

        const wallet = await getWallet(targetId);
        const member = await interaction.guild.members.fetch(targetId).catch(() => null);
        const displayName = member?.displayName ?? fallbackLabel;

        let title, color, changeStr;

        if (sub === 'add') {
            await wallet.addCoins(amount);
            title = '➕ Coins Added';
            color = 0x00c851;
            changeStr = `+${amount.toLocaleString()} 🪙`;

        } else if (sub === 'take') {
            const before = wallet.coins;
            await wallet.removeCoins(amount);
            const actual = before - wallet.coins; // Won't drop below 0
            title = '➖ Coins Removed';
            color = 0xff4444;
            changeStr = `-${actual.toLocaleString()} 🪙`;

        } else if (sub === 'set') {
            wallet.coins = amount;
            await wallet.save();
            title = '🔧 Balance Set';
            color = 0xf5c518;
            changeStr = `= ${amount.toLocaleString()} 🪙`;
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(`Coin transaction completed for **${displayName}**.`)
            .addFields(
                { name: '💸 Transaction', value: `**${changeStr}**`, inline: true },
                { name: '🪙 New Balance', value: `**${wallet.coins.toLocaleString()} 🪙**`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setFooter({ text: `Processed by: ${interaction.user.tag}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

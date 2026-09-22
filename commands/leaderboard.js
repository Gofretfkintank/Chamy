// commands/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const DriverRating = require('../models/DriverRating');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the driver rankings based on overall rating'),

    async execute(interaction) {
        await interaction.deferReply();

        //--------------------------------------------------
        // FETCH & SORT
        //--------------------------------------------------

        const drivers = await DriverRating.find().sort({ 'avg.overall': -1 }).limit(10);

        if (!drivers.length) {
            return interaction.editReply({ content: '❌ No driver rating data found.' });
        }

        //--------------------------------------------------
        // RESOLVE DISPLAY NAMES
        // username alanı boş olabilir — Discord'dan fetch et
        //--------------------------------------------------

        const medals = ['🥇', '🥈', '🥉'];

        const lines = await Promise.all(drivers.map(async (driver, index) => {
            // Önce username cache'e bak, yoksa Discord'dan çek
            let displayName = driver.username || null;

            if (!displayName) {
                try {
                    const user = await interaction.client.users.fetch(driver.userId);
                    displayName = user.username;
                } catch {
                    displayName = `User (${driver.userId.slice(-4)})`; // son 4 hane fallback
                }
            }

            const position = medals[index] ?? `**${index + 1}.**`;

            const overall  = driver.avg.overall  ?? 0;
            const pace     = driver.avg.pace      ?? 0;
            const craft    = driver.avg.racecraft ?? 0;

            return `${position} **${displayName}** — Overall: \`${overall}\`  *(Pace: ${pace} | Racecraft: ${craft})*`;
        }));

        //--------------------------------------------------
        // EMBED
        //--------------------------------------------------

        const embed = new EmbedBuilder()
            .setColor('#E10600')
            .setTitle('🏆 Driver Rating Leaderboard')
            .setDescription(lines.join('\n'))
            .addFields({
                name: '📊 Rating Formula',
                value: 'Pace 25% · Racecraft 20% · Defending 15% · Overtaking 15% · Consistency 15% · Experience 10%'
            })
            .setFooter({
                text: `${drivers.length} drivers rated`,
                iconURL: interaction.guild?.iconURL() || undefined
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};

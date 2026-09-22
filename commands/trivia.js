// commands/trivia.js — F1 Trivia Quiz (Solo & Team Mode)
// Multiple-choice questions about F1 and OM. Speed bonus for first correct answer.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const QUESTIONS = [
    { q: 'Which driver is nicknamed "The Flying Finn"?', options: ['Valtteri Bottas', 'Mika Häkkinen', 'Kimi Räikkönen', 'Heikki Kovalainen'], a: 1, category: '🏁 F1 Classic' },
    { q: 'Who holds the record for the most pole positions in F1 history?', options: ['Michael Schumacher', 'Ayrton Senna', 'Lewis Hamilton', 'Sebastian Vettel'], a: 2, category: '🏁 F1 Classic' },
    { q: 'Which two drivers were involved in the controversial 2021 Abu Dhabi GP final lap?', options: ['Hamilton & Verstappen', 'Bottas & Perez', 'Leclerc & Sainz', 'Alonso & Ocon'], a: 0, category: '🏁 F1 Classic' },
    { q: 'In which city is the Ferrari factory located?', options: ['Milan', 'Turin', 'Maranello', 'Rome'], a: 2, category: '🏁 F1 Classic' },
    { q: 'What does DRS stand for?', options: ['Drag Reduction System', 'Drive Reset Switch', 'Dynamic Racing Servo', 'Dual Rotation System'], a: 0, category: '🏁 F1 Tech' },
    { q: 'What is the approximate record for the fastest F1 pit stop?', options: ['1.82s', '1.58s', '2.10s', '1.92s'], a: 1, category: '🏁 F1 Tech' },
    { q: 'How long is the Monaco Grand Prix circuit?', options: ['3.337 km', '2.998 km', '4.021 km', '3.640 km'], a: 0, category: '🗺️ Circuit' },
    { q: 'Which circuit is famous for having the longest straight on the calendar?', options: ['Monza', 'Spa', 'Silverstone', 'Bahrain'], a: 0, category: '🗺️ Circuit' },
    { q: 'Who was the official F1 Safety Car driver for many years before 2022?', options: ['Johnny Herbert', 'Bernd Maylander', 'Martin Brundle', 'Tom Kristensen'], a: 1, category: '🏁 F1 Classic' },
    { q: 'What does "Parc Fermé" mean?', options: ['Race paddock', 'Cars are locked and cannot be modified', 'DRS activation zone', 'Pit lane entrance'], a: 1, category: '🏁 F1 Tech' },
    { q: 'Where is the Red Bull Racing factory located?', options: ['Vienna', 'Milton Keynes', 'Brackley', 'Woking'], a: 1, category: '🏭 Team' },
    { q: 'Who won the 2023 F1 World Drivers Championship?', options: ['Lewis Hamilton', 'Charles Leclerc', 'Max Verstappen', 'Fernando Alonso'], a: 2, category: '🏆 Champion' },
    { q: 'What is McLaren\'s signature colour called?', options: ['Papaya Orange', 'Sunset Orange', 'Race Orange', 'Burnt Sienna'], a: 0, category: '🏭 Team' },
    { q: 'In which season was the fastest lap bonus point reintroduced?', options: ['2017', '2018', '2019', '2020'], a: 2, category: '🏁 F1 Tech' },
    { q: 'In which year was the first official F1 World Championship season held?', options: ['1948', '1950', '1952', '1955'], a: 1, category: '🏁 F1 Classic' },
    { q: 'What does DRS stand for?', options: ['Drag Reduction System', 'Downforce Removal System', 'Dynamic Racing Suspension', 'Direct Response Steering'], a: 0, category: '🔴 F1 Rules' },
    { q: 'Which platform is OM Panel deployed on?', options: ['Heroku', 'Render', 'Railway', 'Vercel'], a: 2, category: '🔴 OM Special' },
    { q: 'What is the highest privilege level in OM called?', options: ['Admin', 'Moderator', 'Commander', 'Owner'], a: 2, category: '🔴 OM Special' },
    { q: 'What is the minimum weight of an F1 car (with driver) as of 2023?', options: ['698 kg', '752 kg', '798 kg', '820 kg'], a: 2, category: '🔴 F1 Rules' },
    { q: 'Which slash command is used to register as a driver in OM-Bot?', options: ['/signup', '/register', '/join', '/adddriver'], a: 1, category: '🔴 OM Special' },
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('🧠 F1 Trivia Quiz — How much do you know?')
        .addIntegerOption(opt =>
            opt.setName('questions')
                .setDescription('Number of questions (default: 10)')
                .setMinValue(3)
                .setMaxValue(20)
        )
        .addStringOption(opt =>
            opt.setName('mode')
                .setDescription('Game mode')
                .addChoices(
                    { name: '👤 Solo', value: 'solo' },
                    { name: '👥 Team', value: 'team' }
                )
        )
        .addIntegerOption(opt =>
            opt.setName('time_per_question')
                .setDescription('Seconds per question (default: 20)')
                .setMinValue(10)
                .setMaxValue(60)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Trivia game on this server!', ephemeral: true });
        }

        const totalRounds = interaction.options.getInteger('questions') || 10;
        const mode = interaction.options.getString('mode') || 'solo';
        const questionTime = (interaction.options.getInteger('time_per_question') || 20) * 1000;

        const questions = QUESTIONS.sort(() => Math.random() - 0.5).slice(0, totalRounds);

        const game = {
            mode,
            round: 0,
            totalRounds,
            questionTime,
            questions,
            players: new Set([interaction.user.id]),
            scores: new Map([[interaction.user.id, 0]]),
            teams: mode === 'team' ? { red: new Set(), blue: new Set() } : null,
            teamScores: mode === 'team' ? { red: 0, blue: 0 } : null,
            answered: new Set(),
            phase: 'lobby'
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🧠 TRIVIA — F1 Quiz')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Mode: **${mode === 'team' ? '👥 Team' : '👤 Solo'}** | ` +
                `Questions: **${totalRounds}** | ` +
                `Time/Q: **${questionTime / 1000}s**\n\n` +
                (mode === 'team'
                    ? `🔴 Red Team: ${[...game.teams.red].map(id => `<@${id}>`).join(', ') || '—'}\n🔵 Blue Team: ${[...game.teams.blue].map(id => `<@${id}>`).join(', ') || '—'}`
                    : `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}`)
            )
            .setFooter({ text: 'Join and let\'s start!' });

        const lobbyRows = [
            new ActionRowBuilder().addComponents(
                mode === 'team'
                    ? [
                        new ButtonBuilder().setCustomId('tv_red').setLabel('🔴 Red Team').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('tv_blue').setLabel('🔵 Blue Team').setStyle(ButtonStyle.Primary),
                    ]
                    : [new ButtonBuilder().setCustomId('tv_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success)]
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tv_start').setLabel('▶️ Start').setStyle(ButtonStyle.Success)
            )
        ];

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: lobbyRows, fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'tv_join') { game.players.add(i.user.id); game.scores.set(i.user.id, 0); await i.update({ embeds: [lobbyEmbed()] }); }
            if (i.customId === 'tv_red') { game.teams.blue.delete(i.user.id); game.teams.red.add(i.user.id); game.players.add(i.user.id); game.scores.set(i.user.id, 0); await i.update({ embeds: [lobbyEmbed()] }); }
            if (i.customId === 'tv_blue') { game.teams.red.delete(i.user.id); game.teams.blue.add(i.user.id); game.players.add(i.user.id); game.scores.set(i.user.id, 0); await i.update({ embeds: [lobbyEmbed()] }); }
            if (i.customId === 'tv_start') {
                if (!require('../lib/perms').canControlGame(i, interaction.user.id)) return i.reply({ content: '❌ Only the host can start.', ephemeral: true });
                if (game.players.size < 1) return i.reply({ content: '❌ At least 1 player required!', ephemeral: true });
                if (mode === 'team' && (game.teams.red.size < 1 || game.teams.blue.size < 1)) return i.reply({ content: '❌ Each team needs at least 1 player!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.players.size === 0) { activeGames.delete(interaction.guildId); return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Trivia cancelled.')], components: [] }); }
            await runRound(interaction, msg, game);
        });
    }
};

async function runRound(interaction, msg, game) {
    if (game.round >= game.totalRounds) return endGame(interaction, msg, game);

    const q = game.questions[game.round];
    game.round++;
    game.answered.clear();

    const letters = ['A', 'B', 'C', 'D'];
    const optionText = q.options.map((opt, i) => `**${letters[i]}.** ${opt}`).join('\n');
    const row = new ActionRowBuilder().addComponents(
        q.options.map((_, i) => new ButtonBuilder().setCustomId(`tv_ans_${i}`).setLabel(letters[i]).setStyle(ButtonStyle.Secondary))
    );

    const questionEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🧠 QUESTION ${game.round}/${game.totalRounds}`)
        .addFields(
            { name: q.category, value: `**${q.q}**` },
            { name: 'Options', value: optionText }
        )
        .setFooter({ text: `${game.questionTime / 1000}s — Correct answer = +2pts, first correct = +3pts!` });

    await msg.edit({ embeds: [questionEmbed], components: [row] });

    const firstCorrect = { done: false };
    const collector = msg.createMessageComponentCollector({
        filter: i => i.customId.startsWith('tv_ans_') && game.players.has(i.user.id),
        time: game.questionTime
    });

    collector.on('collect', async i => {
        if (game.answered.has(i.user.id)) return i.reply({ content: '✅ Already answered!', ephemeral: true });
        const chosen = parseInt(i.customId.replace('tv_ans_', ''));
        game.answered.add(i.user.id);
        const correct = chosen === q.a;
        if (correct) {
            const pts = !firstCorrect.done ? 3 : 2;
            firstCorrect.done = true;
            game.scores.set(i.user.id, (game.scores.get(i.user.id) || 0) + pts);
            if (game.teams) {
                if (game.teams.red.has(i.user.id)) game.teamScores.red += pts;
                else if (game.teams.blue.has(i.user.id)) game.teamScores.blue += pts;
            }
            await i.reply({ content: `✅ Correct! +${pts}pts`, ephemeral: true });
        } else {
            await i.reply({ content: `❌ Wrong! Correct answer: **${letters[q.a]}. ${q.options[q.a]}**`, ephemeral: true });
        }
        if (game.answered.size >= game.players.size) collector.stop('all');
    });

    collector.on('end', async () => {
        const revealRow = new ActionRowBuilder().addComponents(
            q.options.map((opt, i) => new ButtonBuilder().setCustomId(`tv_done_${i}`).setLabel(letters[i]).setStyle(i === q.a ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true))
        );
        const scoreBoard = [...game.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, pts], i) => `${['🥇','🥈','🥉','4.','5.'][i]} <@${id}> — ${pts}pts`).join('\n');
        const revealEmbed = new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle(`✅ QUESTION ${game.round} — Correct Answer`)
            .addFields(
                { name: q.category, value: `**${q.q}**\nAnswer: **${letters[q.a]}. ${q.options[q.a]}**` },
                {
                    name: game.mode === 'team' ? `Team Score | 🔴 ${game.teamScores.red}pts  🔵 ${game.teamScores.blue}pts` : '📊 Scoreboard',
                    value: game.mode === 'team' ? `Individual:\n${scoreBoard}` : scoreBoard
                }
            );
        await msg.edit({ embeds: [revealEmbed], components: [revealRow] });
        await new Promise(r => setTimeout(r, 3000));
        await runRound(interaction, msg, game);
    });
}

async function endGame(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const final = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
    const winner = final[0];

    let description = '';
    if (game.mode === 'team') {
        const teamWinner = game.teamScores.red > game.teamScores.blue ? '🔴 Red Team' : '🔵 Blue Team';
        description = `🏆 **Team Winner: ${teamWinner}**\n🔴 Red: ${game.teamScores.red}pts | 🔵 Blue: ${game.teamScores.blue}pts\n\n`;
    }
    description += final.map(([id, pts], i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} <@${id}> — ${pts} pts`).join('\n');

    const finalEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 TRIVIA — Final Results')
        .setDescription(description)
        .setFooter({ text: 'Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

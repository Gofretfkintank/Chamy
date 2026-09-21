// commands/whosaidit.js — Who Said It? (Server Message Guessing / Multiple Choice)
// The bot fetches real messages from a channel and asks "Who wrote this?"
// Button-based multiple choice. Scoreboard at the end.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const FALLBACK_QUOTES = [
    { content: 'That pit stop was clean', author: 'ghost_driver' },
    { content: 'Where did that safety car come from', author: 'paddock_boy' },
    { content: 'What happened in qualifying man', author: 'tyre_man' },
    { content: 'That strategy call was wrong 100%', author: 'race_engineer' },
    { content: 'Undercut or overcut, just decide already', author: 'wallman' },
    { content: 'I can make the move in the DRS zone', author: 'brave_driver' },
    { content: 'Last lap last chance full send', author: 'speedster99' },
    { content: 'Fastest lap bonus let\'s go', author: 'lap_king' },
    { content: 'Think it might rain this race', author: 'wetweather' },
    { content: 'Race pace is looking strong this weekend', author: 'setup_god' },
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whosaidit')
        .setDescription('🕵️ Who Said It? — Guess who wrote the message!')
        .addIntegerOption(opt =>
            opt.setName('rounds')
                .setDescription('Number of rounds (default: 5)')
                .setMinValue(3)
                .setMaxValue(15)
        )
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to pull messages from (default: current channel)')
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Who Said It game on this server!', ephemeral: true });
        }

        await interaction.deferReply();

        const totalRounds = interaction.options.getInteger('rounds') || 5;
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        const guild = interaction.guild;
        const members = await guild.members.fetch();
        const humanMembers = members.filter(m => !m.user.bot).map(m => m);

        let quotes = [];
        try {
            const messages = await targetChannel.messages.fetch({ limit: 100 });
            quotes = messages
                .filter(m => !m.author.bot && m.content.length > 10 && m.content.length < 200)
                .map(m => ({ content: m.content, authorId: m.author.id, authorName: m.member?.displayName || m.author.username }));
        } catch (e) { /* No permission */ }

        if (quotes.length < 5) quotes = FALLBACK_QUOTES.map(q => ({ content: q.content, authorId: null, authorName: q.author }));

        quotes = quotes.sort(() => Math.random() - 0.5).slice(0, totalRounds * 2);

        const game = {
            round: 0,
            totalRounds,
            quotes: quotes.sort(() => Math.random() - 0.5),
            scores: new Map(),
            voters: new Set(),
            humanMembers,
            phase: 'lobby',
            players: new Set(),
            currentCorrect: null,
            currentOptions: null
        };
        activeGames.set(interaction.guildId, game);

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('wsi_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('wsi_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x1e3a5f)
            .setTitle('🕵️ WHO SAID IT?')
            .setDescription(
                `**${interaction.user.displayName}** is setting up a game!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ') || 'none yet'}\n\n` +
                `📊 **${totalRounds} rounds** — Messages from ${targetChannel}`
            )
            .setFooter({ text: 'Press Join to enter!' });

        const msg = await interaction.editReply({ embeds: [lobbyEmbed()], components: [joinRow] });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'wsi_join') {
                game.players.add(i.user.id);
                game.scores.set(i.user.id, 0);
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'wsi_start') {
                if (!require('../lib/perms').canControlGame(i, interaction.user.id)) {
                    return i.reply({ content: '❌ Only the host can start the game.', ephemeral: true });
                }
                if (game.players.size < 2) return i.reply({ content: '❌ At least 2 players required!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.players.size < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Game cancelled.')], components: [] });
            }
            await runRound(interaction, msg, game);
        });
    }
};

async function runRound(interaction, msg, game) {
    game.round++;
    game.voters.clear();

    if (game.round > game.quotes.length || game.round > game.totalRounds) return endGame(interaction, msg, game);

    const quote = game.quotes[game.round - 1];
    const players = [...game.players];

    let options = [];
    if (quote.authorId) {
        options.push({ id: quote.authorId, name: quote.authorName, correct: true });
        const others = game.humanMembers
            .filter(m => m.id !== quote.authorId)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .map(m => ({ id: m.id, name: m.displayName || m.user.username, correct: false }));
        options = [...options, ...others].sort(() => Math.random() - 0.5);
    } else {
        options = [
            { id: 'opt_a', name: quote.authorName, correct: true },
            { id: 'opt_b', name: 'paddock_boy', correct: false },
            { id: 'opt_c', name: 'race_engineer', correct: false },
            { id: 'opt_d', name: 'speedster99', correct: false },
        ].sort(() => Math.random() - 0.5);
    }

    game.currentCorrect = options.find(o => o.correct).id;
    game.currentOptions = options;

    const row = new ActionRowBuilder().addComponents(
        options.map(opt =>
            new ButtonBuilder()
                .setCustomId(`wsi_ans_${opt.id}`)
                .setLabel(opt.name.substring(0, 25))
                .setStyle(ButtonStyle.Secondary)
        )
    );

    const roundEmbed = () => new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🕵️ ROUND ${game.round}/${game.totalRounds} — Who Said It?`)
        .setDescription(`> "${quote.content}"\n\n**Who wrote this message?**`)
        .addFields({
            name: '👥 Votes Cast',
            value: players.map(id => `<@${id}> ${game.voters.has(id) ? '✅' : '⏳'}`).join('\n')
        })
        .setFooter({ text: '20 seconds — correct answer = +2 points!' });

    await msg.edit({ embeds: [roundEmbed()], components: [row] });

    const answerMap = new Map();
    const collector = msg.createMessageComponentCollector({
        filter: i => i.customId.startsWith('wsi_ans_') && game.players.has(i.user.id),
        time: 20_000
    });

    collector.on('collect', async i => {
        if (game.voters.has(i.user.id)) return i.reply({ content: '✅ Already voted!', ephemeral: true });
        const chosenId = i.customId.replace('wsi_ans_', '');
        game.voters.add(i.user.id);
        answerMap.set(i.user.id, chosenId);
        const isCorrect = chosenId === game.currentCorrect;
        if (isCorrect) game.scores.set(i.user.id, (game.scores.get(i.user.id) || 0) + 2);
        await i.reply({ content: isCorrect ? '✅ Correct!' : '❌ Wrong!', ephemeral: true });
        if (game.voters.size >= game.players.size) collector.stop('all_voted');
    });

    collector.on('end', async () => {
        const correctOpt = game.currentOptions.find(o => o.correct);
        const revealRow = new ActionRowBuilder().addComponents(
            game.currentOptions.map(opt =>
                new ButtonBuilder()
                    .setCustomId(`wsi_done_${opt.id}`)
                    .setLabel(opt.name.substring(0, 25))
                    .setStyle(opt.correct ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setDisabled(true)
            )
        );

        const winners = [...answerMap.entries()].filter(([, id]) => id === game.currentCorrect).map(([uid]) => `<@${uid}>`);

        const revealEmbed = new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle(`✅ ROUND ${game.round} RESULT`)
            .setDescription(
                `> "${quote.content}"\n\n` +
                `**Written by: ${correctOpt.name}**\n\n` +
                (winners.length ? `🎉 Correct: ${winners.join(', ')}` : '😢 Nobody got it right!')
            )
            .addFields({
                name: '📊 Scoreboard',
                value: [...game.scores.entries()].sort((a, b) => b[1] - a[1]).map(([id, pts], i) => `${i + 1}. <@${id}> — ${pts}pts`).join('\n') || '—'
            });

        await msg.edit({ embeds: [revealEmbed], components: [revealRow] });
        await new Promise(r => setTimeout(r, 4000));

        if (game.round < game.totalRounds) await runRound(interaction, msg, game);
        else await endGame(interaction, msg, game);
    });
}

async function endGame(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const final = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
    const winner = final[0];

    const finalEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 WHO SAID IT — Final Results')
        .setDescription(
            `🎉 **Winner: <@${winner[0]}>** — **${winner[1]} points**\n\n` +
            final.map(([id, pts], i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} <@${id}> — ${pts} pts`).join('\n')
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

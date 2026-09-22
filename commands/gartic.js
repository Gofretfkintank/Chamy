// commands/gartic.js — Gartic (Emoji Drawing / Guessing)
// One player describes a secret word using ONLY emojis (no text).
// Others race to guess the word. Points for correct guesses and for drawing.
// F1-themed word pool.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const WORD_POOLS = {
    f1: [
        'Safety Car', 'Pit Stop', 'Pole Position', 'Fastest Lap', 'Checkered Flag',
        'Wet Race', 'Crash', 'Overtake', 'DRS', 'Podium',
        'Helmet', 'Steering Wheel', 'Tyre Change', 'Radio', 'Penalty',
        'Sprint Race', 'Jump Start', 'Parc Ferme', 'Gravel Trap', 'Kerb',
        'Monaco Street', 'Night Race', 'Red Flag', 'Virtual Safety Car', 'Team Orders',
        'Undercut', 'Box Box', 'Lap Record', 'Garage', 'Paddock',
    ],
    general: [
        'Pizza', 'Racing', 'Discord', 'Trophy', 'Sunset',
        'Airport', 'Coffee', 'Thunderstorm', 'Mountain', 'Party',
        'Rocket', 'Ocean', 'Birthday', 'Game Night', 'Champion',
    ]
};

const ALL_WORDS = [...WORD_POOLS.f1, ...WORD_POOLS.general];

const ROUND_TIME   = 90;   // seconds per round to draw & guess
const GUESS_POINTS = 3;    // points for a correct guess
const DRAW_POINTS  = 2;    // points per guesser who got it right
const FAST_BONUS   = 1;    // bonus for first correct guess

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gartic')
        .setDescription('🎨 Gartic — Describe a word using ONLY emojis, others guess!')
        .addIntegerOption(opt =>
            opt.setName('rounds')
                .setDescription('Number of rounds (default: 4)')
                .setMinValue(2)
                .setMaxValue(10)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Gartic game on this server!', ephemeral: true });
        }

        const totalRounds = interaction.options.getInteger('rounds') || 4;

        const game = {
            hostId: interaction.user.id,
            players: new Set([interaction.user.id]),
            scores: new Map([[interaction.user.id, 0]]),
            round: 0,
            totalRounds,
            phase: 'lobby',
            drawerIdx: 0,
            guessedThisRound: new Set()
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🎨 GARTIC — Emoji Drawing!')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
                `📊 **${totalRounds} rounds** — Each round someone draws with emojis only!\n\n` +
                `🎨 Drawer gets **+${DRAW_POINTS}pts** per correct guesser.\n` +
                `🔍 Guessers get **+${GUESS_POINTS}pts** (first correct: +${GUESS_POINTS + FAST_BONUS}pts).`
            )
            .setFooter({ text: 'Press Join to enter, host presses Start' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('gar_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('gar_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'gar_join') {
                if (game.players.has(i.user.id)) return i.reply({ content: '✅ Already joined!', ephemeral: true });
                game.players.add(i.user.id);
                game.scores.set(i.user.id, 0);
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'gar_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only host can start.', ephemeral: true });
                if (game.players.size < 2) return i.reply({ content: '❌ At least 2 players needed!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.players.size < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Gartic cancelled.')], components: [] });
            }
            await runRound(interaction, msg, game);
        });
    }
};

async function runRound(interaction, msg, game) {
    if (game.round >= game.totalRounds) return endGame(interaction, msg, game);

    game.round++;
    game.guessedThisRound.clear();

    const players = [...game.players];
    const drawerIdx = (game.drawerIdx++) % players.length;
    const drawerId = players[drawerIdx];
    const word = ALL_WORDS[Math.floor(Math.random() * ALL_WORDS.length)];

    // DM the drawer their word
    try {
        const drawerUser = await interaction.client.users.fetch(drawerId);
        const wordEmbed = new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🎨 Your Drawing Word!')
            .setDescription(`Your word is:\n\n# **${word}**\n\nDescribe it using **ONLY emojis** — no text, no letters!\nSend your emoji drawing in the game channel.`)
            .setFooter({ text: 'You have 90 seconds once the round starts.' });
        await drawerUser.send({ embeds: [wordEmbed] });
    } catch (e) { /* DMs closed */ }

    // Channel: announce drawer, wait for emoji drawing
    const waitEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🎨 ROUND ${game.round}/${game.totalRounds}`)
        .setDescription(
            `<@${drawerId}> is the **Drawer** this round!\n\n` +
            `🎨 Drawer: check your DM for the secret word, then send your **emoji description** here!\n\n` +
            `🔍 Everyone else: once the drawing appears, **type your guess** in this channel!`
        )
        .setFooter({ text: '90 seconds once the drawing is posted.' });

    await msg.edit({ embeds: [waitEmbed], components: [] });

    // Wait for drawer's emoji message
    let drawing = null;
    let drawingMsg = null;

    const drawCollector = interaction.channel.createMessageCollector({
        filter: m => m.author.id === drawerId && /\p{Emoji}/u.test(m.content) && !m.content.match(/[a-zA-Z]/),
        time: 60_000
    });

    await new Promise(resolve => {
        drawCollector.on('collect', async m => {
            drawing = m.content;
            drawingMsg = m;
            drawCollector.stop('drawn');
            resolve();
        });
        drawCollector.on('end', (_, r) => { if (r !== 'drawn') resolve(); });
    });

    if (!drawing) {
        const skipEmbed = new EmbedBuilder()
            .setColor(0x555555)
            .setTitle(`⏰ ROUND ${game.round} — Drawer didn't post in time!`)
            .setDescription(`<@${drawerId}> didn't post their emoji drawing. Skipping round...\nThe word was: **${word}**`);
        await msg.edit({ embeds: [skipEmbed] });
        await new Promise(r => setTimeout(r, 3000));
        return runRound(interaction, msg, game);
    }

    // Reveal drawing to channel
    const guessEmbed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle(`🎨 ROUND ${game.round} — What is this?`)
        .setDescription(
            `**Drawing by <@${drawerId}>:**\n\n# ${drawing}\n\n` +
            `🔍 **Type your guess in this channel!** (${ROUND_TIME} seconds)`
        )
        .addFields({
            name: '👥 Status',
            value: [...game.players].filter(id => id !== drawerId).map(id => `<@${id}> ⏳`).join('\n') || '—'
        })
        .setFooter({ text: `${ROUND_TIME}s to guess! Drawer: DO NOT type the answer.` });

    await msg.edit({ embeds: [guessEmbed] });

    // Guess collector
    let firstCorrect = false;
    let drawerBonus = 0;

    const guessCollector = interaction.channel.createMessageCollector({
        filter: m => game.players.has(m.author.id) && m.author.id !== drawerId && !game.guessedThisRound.has(m.author.id) && game.phase !== 'done',
        time: ROUND_TIME * 1000
    });

    guessCollector.on('collect', async m => {
        const guess = m.content.trim().toLowerCase();
        const correct = word.toLowerCase();
        const isCorrect = guess === correct || (guess.length > 4 && correct.includes(guess)) || (correct.length > 4 && guess.includes(correct));

        await m.delete().catch(() => {});

        if (isCorrect) {
            game.guessedThisRound.add(m.author.id);
            const pts = GUESS_POINTS + (!firstCorrect ? FAST_BONUS : 0);
            if (!firstCorrect) firstCorrect = true;
            game.scores.set(m.author.id, (game.scores.get(m.author.id) || 0) + pts);
            drawerBonus += DRAW_POINTS;

            const correctMsg = await interaction.channel.send({ content: `✅ <@${m.author.id}> guessed it! **+${pts}pts**` });
            setTimeout(() => correctMsg.delete().catch(() => {}), 5000);

            // Update status
            const updatedEmbed = EmbedBuilder.from(guessEmbed)
                .setFields({
                    name: '👥 Status',
                    value: [...game.players].filter(id => id !== drawerId).map(id => `<@${id}> ${game.guessedThisRound.has(id) ? '✅' : '⏳'}`).join('\n')
                });
            await msg.edit({ embeds: [updatedEmbed] });

            if (game.guessedThisRound.size >= game.players.size - 1) {
                guessCollector.stop('all_guessed');
            }
        } else {
            const wrongMsg = await interaction.channel.send({ content: `❌ <@${m.author.id}>: wrong guess!` });
            setTimeout(() => wrongMsg.delete().catch(() => {}), 3000);
        }
    });

    guessCollector.on('end', async () => {
        // Award drawer
        game.scores.set(drawerId, (game.scores.get(drawerId) || 0) + drawerBonus);

        const guessersWho = [...game.guessedThisRound].map(id => `<@${id}>`).join(', ') || 'Nobody';

        const revealEmbed = new EmbedBuilder()
            .setColor(game.guessedThisRound.size > 0 ? 0x00c851 : 0x555555)
            .setTitle(`✅ ROUND ${game.round} RESULT`)
            .setDescription(
                `**The word was: ${word}**\n\n` +
                `${drawing}\n\n` +
                `Correct guessers: ${guessersWho}\n` +
                `Drawer (<@${drawerId}>) earned: **+${drawerBonus}pts**`
            )
            .addFields({
                name: '📊 Scoreboard',
                value: [...game.scores.entries()].sort((a, b) => b[1] - a[1]).map(([id, pts], i) => `${['🥇','🥈','🥉'][i] || `${i+1}.`} <@${id}> — ${pts}pts`).join('\n')
            });

        await msg.edit({ embeds: [revealEmbed] });
        await new Promise(r => setTimeout(r, 5000));
        await runRound(interaction, msg, game);
    });
}

async function endGame(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const final = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
    const winner = final[0];

    const finalEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 GARTIC — Final Results')
        .setDescription(
            `🎉 **Winner: <@${winner[0]}>** — **${winner[1]} points**\n\n` +
            final.map(([id, pts], i) => `${['🥇','🥈','🥉'][i] || `${i+1}.`} <@${id}> — ${pts}pts`).join('\n')
        )
        .setFooter({ text: 'Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

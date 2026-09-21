// commands/numguess.js — Number Guess Battle (Multiplayer Number Guessing / Proximity System)
// The bot picks a random number. Players type their guesses in chat.
// The closest guess wins each round. Multi-round with a scoreboard.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('numguess')
        .setDescription('🔢 Number Guess Battle — Guess closest to win!')
        .addIntegerOption(opt =>
            opt.setName('rounds')
                .setDescription('Number of rounds (default: 3)')
                .setMinValue(1)
                .setMaxValue(10)
        )
        .addIntegerOption(opt =>
            opt.setName('max')
                .setDescription('Upper limit of the number range (default: 100)')
                .setMinValue(10)
                .setMaxValue(1000)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Number Guess game on this server!', ephemeral: true });
        }

        const totalRounds = interaction.options.getInteger('rounds') || 3;
        const maxNum = interaction.options.getInteger('max') || 100;

        const game = {
            hostId: interaction.user.id,
            players: new Set([interaction.user.id]),
            scores: new Map([[interaction.user.id, 0]]),
            round: 0,
            totalRounds,
            maxNum,
            phase: 'lobby',
            currentNumber: null,
            guesses: new Map()
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x1e3a5f)
            .setTitle('🔢 NUMBER GUESS BATTLE')
            .setDescription(
                `**${interaction.user.displayName}** is setting up a game!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
                `📊 **${totalRounds} round${totalRounds > 1 ? 's' : ''}** — Numbers from **1 to ${maxNum}**`
            )
            .setFooter({ text: 'Press Join to enter, host presses Start to begin.' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ng_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('ng_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'ng_join') {
                if (game.players.has(i.user.id)) return i.reply({ content: '✅ You already joined!', ephemeral: true });
                game.players.add(i.user.id);
                game.scores.set(i.user.id, 0);
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'ng_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) {
                    return i.reply({ content: '❌ Only the host can start the game.', ephemeral: true });
                }
                if (game.players.size < 2) return i.reply({ content: '❌ At least 2 players required!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async (_, reason) => {
            if (game.players.size < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Game cancelled — not enough players.')], components: [] });
            }
            for (const id of game.players) if (!game.scores.has(id)) game.scores.set(id, 0);
            await runRound(interaction, msg, game);
        });
    }
};

async function runRound(interaction, msg, game) {
    game.round++;
    game.guesses.clear();
    game.currentNumber = Math.floor(Math.random() * game.maxNum) + 1;
    game.phase = 'guessing';

    const players = [...game.players];

    const roundEmbed = () => new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🔢 ROUND ${game.round}/${game.totalRounds}`)
        .setDescription(
            `I'm thinking of a number between **1 and ${game.maxNum}**!\n\n` +
            `Type your guess in this channel. Closest answer wins the round.\n\n` +
            `**Status:**\n${players.map(id => `<@${id}> ${game.guesses.has(id) ? '✅' : '⏳'}`).join('\n')}`
        )
        .setFooter({ text: '30 seconds — closest guess wins!' });

    const guessRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ng_guess').setLabel('🔢 Submit Guess').setStyle(ButtonStyle.Primary)
    );

    await msg.edit({ embeds: [roundEmbed()], components: [guessRow] });

    const buttonCollector = msg.createMessageComponentCollector({
        filter: i => i.customId === 'ng_guess' && game.players.has(i.user.id),
        time: 30_000
    });
    buttonCollector.on('collect', async i => {
        if (game.guesses.has(i.user.id)) return i.reply({ content: '✅ Already guessed!', ephemeral: true });
        await i.reply({ content: `🔢 **Type a number between 1 and ${game.maxNum} in this channel!**`, ephemeral: true });
    });

    const chanCollector = interaction.channel.createMessageCollector({
        filter: m => game.players.has(m.author.id) && !game.guesses.has(m.author.id) && game.phase === 'guessing',
        time: 30_000
    });

    chanCollector.on('collect', async m => {
        const num = parseInt(m.content.trim());
        if (isNaN(num) || num < 1 || num > game.maxNum) {
            const err = await m.reply({ content: `❌ Please enter a valid number between 1 and ${game.maxNum}!` });
            setTimeout(() => err.delete().catch(() => {}), 3000);
            await m.delete().catch(() => {});
            return;
        }
        game.guesses.set(m.author.id, num);
        await m.delete().catch(() => {});
        await msg.edit({ embeds: [roundEmbed()] });
        if (game.guesses.size >= players.length) { chanCollector.stop('all_guessed'); buttonCollector.stop('done'); }
    });

    chanCollector.on('end', async () => {
        buttonCollector.stop();
        await resolveRound(interaction, msg, game, players);
    });
}

async function resolveRound(interaction, msg, game, players) {
    game.phase = 'result';
    const secret = game.currentNumber;
    const pointMap = [3, 2, 1];

    const sorted = players
        .filter(id => game.guesses.has(id))
        .map(id => ({ id, guess: game.guesses.get(id), diff: Math.abs(game.guesses.get(id) - secret) }))
        .sort((a, b) => a.diff - b.diff);

    for (let i = 0; i < sorted.length; i++) {
        const pts = pointMap[i] || 0;
        game.scores.set(sorted[i].id, (game.scores.get(sorted[i].id) || 0) + pts);
    }

    const resultLines = sorted.map((r, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        return `${medal} <@${r.id}> — guessed **${r.guess}** (off by ${r.diff}) +${pointMap[i] || 0}pts`;
    });

    for (const id of players) {
        if (!game.guesses.has(id)) resultLines.push(`⬛ <@${id}> — no guess submitted`);
    }

    const roundEmbed = new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle(`✅ ROUND ${game.round} RESULT`)
        .setDescription(`**The number was: ${secret}**\n\n${resultLines.join('\n')}`)
        .addFields({
            name: '📊 Scoreboard',
            value: [...game.scores.entries()].sort((a, b) => b[1] - a[1]).map(([id, pts], i) => `${i + 1}. <@${id}> — ${pts}pts`).join('\n')
        });

    await msg.edit({ embeds: [roundEmbed], components: [] });

    if (game.round < game.totalRounds) {
        await new Promise(r => setTimeout(r, 4000));
        await runRound(interaction, msg, game);
    } else {
        await endGame(interaction, msg, game);
    }
}

async function endGame(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const final = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
    const winner = final[0];

    const finalEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 NUMBER GUESS BATTLE — Final Results')
        .setDescription(
            `🎉 **Winner: <@${winner[0]}>** — **${winner[1]} points**\n\n` +
            final.map(([id, pts], i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} <@${id}> — ${pts} pts`).join('\n')
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

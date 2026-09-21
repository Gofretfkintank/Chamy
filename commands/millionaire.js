// commands/millionaire.js — Who Wants to Be a Millionaire? (Team Mode)
// Classic WWTBAM with 15 questions of increasing difficulty.
// Team votes on the answer. Lifelines: 50/50, Ask the Audience, Phone a Friend.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const PRIZE_LADDER = [
    100, 200, 300, 500, 1_000,
    2_000, 4_000, 8_000, 16_000, 32_000,
    64_000, 125_000, 250_000, 500_000, 1_000_000
];

const SAFE_HAVENS = [4, 9]; // indices of guaranteed prizes (1000 & 32000)

const QUESTIONS = [
    // ── Easy (1-5) ────────────────────────────────────────────────────────────
    { q: 'What colour is a red flag in F1?', options: ['A: Blue','B: Yellow','C: Red','D: Green'], a: 'C', diff: 'easy' },
    { q: 'How many wheels does an F1 car have?', options: ['A: 2','B: 4','C: 6','D: 8'], a: 'B', diff: 'easy' },
    { q: 'What does "pit stop" involve?', options: ['A: Coffee break','B: Tyre & fuel change','C: Driver change','D: Engine swap'], a: 'B', diff: 'easy' },
    { q: 'Which country hosts the Monaco GP?', options: ['A: France','B: Italy','C: Monaco','D: Spain'], a: 'C', diff: 'easy' },
    { q: 'What is pole position?', options: ['A: Last on grid','B: First on grid','C: Middle of grid','D: Pit lane'], a: 'B', diff: 'easy' },
    // ── Medium (6-10) ─────────────────────────────────────────────────────────
    { q: 'What does DRS stand for?', options: ['A: Drag Reduction System','B: Drive Reset Switch','C: Dual Racing Servo','D: Dynamic Roll Stabiliser'], a: 'A', diff: 'medium' },
    { q: 'Which team uses the "Prancing Horse" logo?', options: ['A: Mercedes','B: Red Bull','C: Ferrari','D: McLaren'], a: 'C', diff: 'medium' },
    { q: 'In which year was the sprint race format introduced?', options: ['A: 2019','B: 2020','C: 2021','D: 2022'], a: 'C', diff: 'medium' },
    { q: 'Which driver won the most F1 championships?', options: ['A: Senna','B: Schumacher/Hamilton (tied)','C: Vettel','D: Prost'], a: 'B', diff: 'medium' },
    { q: 'What is the penalty for a jump start?', options: ['A: Disqualification','B: 10-second stop-go','C: Black flag','D: Drive-through penalty'], a: 'D', diff: 'medium' },
    // ── Hard (11-15) ──────────────────────────────────────────────────────────
    { q: 'Which circuit has the highest average speed?', options: ['A: Spa','B: Silverstone','C: Monza','D: Bahrain'], a: 'C', diff: 'hard' },
    { q: 'What year did Ayrton Senna win his first championship?', options: ['A: 1985','B: 1986','C: 1987','D: 1988'], a: 'D', diff: 'hard' },
    { q: 'What is "marbling" in F1 tyres?', options: ['A: Visual tyre design','B: Rubber debris on racing line','C: Thermal degradation pattern','D: Grip compound marking'], a: 'B', diff: 'hard' },
    { q: 'Which team produced the first "double diffuser"?', options: ['A: Ferrari','B: Red Bull','C: Brawn GP','D: Toyota'], a: 'C', diff: 'hard' },
    { q: 'In 2021, how many points did Max Verstappen win the championship by?', options: ['A: 8','B: 1','C: 5','D: 12'], a: 'A', diff: 'hard' },
];

const DIFF_COLORS = { easy: 0x00c851, medium: 0xf5c518, hard: 0x8b0000 };

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('millionaire')
        .setDescription('💰 Who Wants to Be a Millionaire? — Team voting, lifelines, 15 questions!')
        .addIntegerOption(opt =>
            opt.setName('vote_time')
                .setDescription('Seconds to vote per question (default: 25)')
                .setMinValue(10)
                .setMaxValue(60)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Millionaire game on this server!', ephemeral: true });
        }

        const voteTime = (interaction.options.getInteger('vote_time') || 25) * 1000;

        const game = {
            hostId: interaction.user.id,
            players: new Set([interaction.user.id]),
            phase: 'lobby',
            questionIdx: 0,
            prize: 0,
            lifelines: { fifty: true, audience: true, phone: true },
            voteTime,
            walkAway: false
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('💰 WHO WANTS TO BE A MILLIONAIRE?')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
                `**Team Mode:** Everyone votes on each answer.\n\n` +
                `🛟 Lifelines available:\n• **50:50** — removes 2 wrong answers\n• **Ask the Audience** — shows vote distribution\n• **Phone a Friend** — asks the bot for a hint`
            )
            .setFooter({ text: 'Join before start, then vote together!' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mm_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('mm_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'mm_join') { game.players.add(i.user.id); await i.update({ embeds: [lobbyEmbed()] }); }
            if (i.customId === 'mm_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only host can start.', ephemeral: true });
                if (game.players.size < 1) return i.reply({ content: '❌ At least 1 player needed!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            game.phase = 'playing';
            await askQuestion(interaction, msg, game);
        });
    }
};

function buildPrizeLadder(current) {
    return PRIZE_LADDER.map((p, i) => {
        const num = String(i + 1).padStart(2, '0');
        const isSafe = SAFE_HAVENS.includes(i);
        const isCurrent = i === current;
        const prize = `£${p.toLocaleString()}`;
        if (isCurrent) return `▶️ **${num}. ${prize}**`;
        if (isSafe)    return `🔒 ${num}. ${prize}`;
        return `  ${num}. ${prize}`;
    }).reverse().join('\n');
}

async function askQuestion(interaction, msg, game) {
    if (game.questionIdx >= QUESTIONS.length) return victory(interaction, msg, game);

    const q = QUESTIONS[game.questionIdx];
    const prize = PRIZE_LADDER[game.questionIdx];
    const color = DIFF_COLORS[q.diff];

    const lifelines = [
        game.lifelines.fifty   && new ButtonBuilder().setCustomId('mm_5050').setLabel('50:50').setStyle(ButtonStyle.Secondary),
        game.lifelines.audience && new ButtonBuilder().setCustomId('mm_audience').setLabel('📊 Audience').setStyle(ButtonStyle.Secondary),
        game.lifelines.phone    && new ButtonBuilder().setCustomId('mm_phone').setLabel('📞 Phone').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('mm_walkaway').setLabel('🚪 Walk Away').setStyle(ButtonStyle.Danger),
    ].filter(Boolean);

    const answerRow = new ActionRowBuilder().addComponents(
        ['A','B','C','D'].map(l =>
            new ButtonBuilder().setCustomId(`mm_ans_${l}`).setLabel(l).setStyle(ButtonStyle.Primary)
        )
    );
    const lifelineRow = new ActionRowBuilder().addComponents(lifelines);

    let activeOptions = [...q.options]; // may shrink after 50:50

    const buildEmbed = (opts = activeOptions, note = '') => new EmbedBuilder()
        .setColor(color)
        .setTitle(`💰 Question ${game.questionIdx + 1}/15 — For £${prize.toLocaleString()}!`)
        .addFields(
            { name: `❓ ${q.diff.toUpperCase()}`, value: `**${q.q}**` },
            { name: 'Options', value: opts.join('\n') },
            { name: 'Prize Ladder', value: buildPrizeLadder(game.questionIdx), inline: true }
        )
        .setDescription(note || `⏱️ Vote on an answer — majority wins! (${game.voteTime / 1000}s)`)
        .setFooter({ text: `Lifelines: 50:50 ${game.lifelines.fifty ? '✅':'❌'} | Audience ${game.lifelines.audience ? '✅':'❌'} | Phone ${game.lifelines.phone ? '✅':'❌'}` });

    await msg.edit({ embeds: [buildEmbed()], components: [answerRow, lifelineRow] });

    const votes = new Map(); // userId -> letter
    let lifelineUsed = false;

    const collector = msg.createMessageComponentCollector({
        filter: i => (i.customId.startsWith('mm_ans_') || ['mm_5050','mm_audience','mm_phone','mm_walkaway'].includes(i.customId)) && game.players.has(i.user.id),
        time: game.voteTime
    });

    collector.on('collect', async i => {
        // Walk away
        if (i.customId === 'mm_walkaway') {
            if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only host can walk away.', ephemeral: true });
            game.walkAway = true;
            collector.stop('walkaway');
            await i.deferUpdate();
            return;
        }

        // Lifeline: 50:50
        if (i.customId === 'mm_5050') {
            if (!game.lifelines.fifty) return i.reply({ content: '❌ Already used!', ephemeral: true });
            game.lifelines.fifty = false;
            lifelineUsed = true;
            const wrong = q.options.filter(o => !o.startsWith(`${q.a}:`));
            const remove = wrong.sort(() => Math.random() - 0.5).slice(0, 2);
            activeOptions = q.options.filter(o => !remove.includes(o));
            await msg.edit({ embeds: [buildEmbed(activeOptions, '🔪 50:50 used — two wrong answers removed!')], components: [answerRow, lifelineRow] });
            return i.deferUpdate();
        }

        // Lifeline: Audience
        if (i.customId === 'mm_audience') {
            if (!game.lifelines.audience) return i.reply({ content: '❌ Already used!', ephemeral: true });
            game.lifelines.audience = false;
            // Audience skews toward correct answer
            const pcts = { A: 10, B: 10, C: 10, D: 10 };
            pcts[q.a] = 55 + Math.floor(Math.random() * 20);
            const total = Object.values(pcts).reduce((a, b) => a + b, 0);
            const dist = Object.entries(pcts).map(([l, v]) => `${l}: **${Math.round((v / total) * 100)}%**`).join(' | ');
            await msg.edit({ embeds: [buildEmbed(activeOptions, `📊 Audience says: ${dist}`)], components: [answerRow, lifelineRow] });
            return i.deferUpdate();
        }

        // Lifeline: Phone a Friend
        if (i.customId === 'mm_phone') {
            if (!game.lifelines.phone) return i.reply({ content: '❌ Already used!', ephemeral: true });
            game.lifelines.phone = false;
            const hints = [
                `I'm pretty sure it's **${q.a}**... but don't quote me!`,
                `It's definitely **${q.a}**, I saw this in a documentary!`,
                `Hmm... I'd go with **${q.a}** but I'm only 70% confident.`,
                `My gut says **${q.a}**. Go for it!`,
            ];
            const hint = hints[Math.floor(Math.random() * hints.length)];
            await msg.edit({ embeds: [buildEmbed(activeOptions, `📞 Your friend says: "${hint}"`)], components: [answerRow, lifelineRow] });
            return i.deferUpdate();
        }

        // Answer vote
        if (i.customId.startsWith('mm_ans_')) {
            const letter = i.customId.replace('mm_ans_', '');
            votes.set(i.user.id, letter);
            await i.reply({ content: `✅ Voted **${letter}**!`, ephemeral: true });
            if (votes.size >= game.players.size) collector.stop('all_voted');
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'walkaway') {
            return walkAway(interaction, msg, game);
        }

        // Tally votes
        const tally = { A: 0, B: 0, C: 0, D: 0 };
        for (const v of votes.values()) tally[v] = (tally[v] || 0) + 1;

        const topVote = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
        const correct = topVote === q.a;

        // Prize on safe haven if wrong
        const safeIdx = SAFE_HAVENS.filter(s => s < game.questionIdx).pop() ?? -1;
        const safePrize = safeIdx >= 0 ? PRIZE_LADDER[safeIdx] : 0;

        const voteDisplay = ['A','B','C','D'].map(l => `${l}: ${tally[l] || 0} vote${tally[l] !== 1 ? 's' : ''}`).join(' | ');

        const resultEmbed = new EmbedBuilder()
            .setColor(correct ? 0x00c851 : 0x8b0000)
            .setTitle(correct ? `✅ CORRECT! £${prize.toLocaleString()}!` : `❌ WRONG! Game over.`)
            .addFields(
                { name: '❓ Question', value: q.q },
                { name: '✅ Correct Answer', value: `**${q.a}:** ${q.options.find(o => o.startsWith(q.a + ':'))?.replace(/^.\:/, '') || ''}` },
                { name: '📊 Team Votes', value: voteDisplay },
                { name: '🏆 Prize', value: correct ? `£${prize.toLocaleString()}` : `Leaving with £${safePrize.toLocaleString()} (safe haven)` }
            );

        await msg.edit({ embeds: [resultEmbed], components: [] });

        if (!correct) {
            await new Promise(r => setTimeout(r, 4000));
            return gameOver(interaction, msg, game, safePrize);
        }

        game.prize = prize;
        game.questionIdx++;
        await new Promise(r => setTimeout(r, 4000));
        await askQuestion(interaction, msg, game);
    });
}

async function walkAway(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const embed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🚪 Team Walked Away!')
        .setDescription(`The team walked away with **£${game.prize.toLocaleString()}**!\n\n*Sometimes the smart play is knowing when to stop.*`)
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });
    await msg.edit({ embeds: [embed], components: [] });
}

async function gameOver(interaction, msg, game, safePrize) {
    activeGames.delete(interaction.guildId);
    const embed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle('💸 Game Over!')
        .setDescription(`The team leaves with the safe haven prize of **£${safePrize.toLocaleString()}**.\n\nBetter luck next time!`)
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });
    await msg.edit({ embeds: [embed], components: [] });
}

async function victory(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const embed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 YOU WIN £1,000,000!')
        .setDescription(
            `🎉 **INCREDIBLE!** The team answered all 15 questions correctly!\n\n` +
            `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
            `*You are MILLIONAIRES!*`
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });
    await msg.edit({ embeds: [embed], components: [] });
}

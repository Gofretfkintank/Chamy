// commands/feign.js — Feign (Social Deduction / Role Play)
// Each player receives a secret role. One person is the "Feigner" (impostor).
// The Feigner tries to answer the F1 question wrongly but convincingly.
// Others try to catch them. Majority vote decides.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const F1_QUESTIONS = [
    { q: 'Which team won the 2023 Constructors Championship?', a: 'Red Bull Racing' },
    { q: 'Which driver holds the record for most F1 World Championships?', a: 'Lewis Hamilton & Michael Schumacher (7 each)' },
    { q: 'In which country is the Monaco Grand Prix held?', a: 'Monaco' },
    { q: 'What does DRS stand for?', a: 'Drag Reduction System' },
    { q: 'Which is the longest circuit on the F1 calendar?', a: 'Spa-Francorchamps' },
    { q: 'What position is called "pole position"?', a: '1st on the grid' },
    { q: 'What is the name of the car deployed during on-track incidents?', a: 'Safety Car' },
    { q: 'What bonus is awarded for the fastest lap during a race?', a: '1 extra championship point' },
    { q: 'What does Parc Fermé mean?', a: 'Cars cannot be modified after qualifying' },
    { q: 'Who sets the DRS activation zones on each circuit?', a: 'The FIA' },
    { q: 'When is a Virtual Safety Car (VSC) deployed?', a: 'When there is a hazard but a full SC is not required' },
    { q: 'In which season were sprint races first introduced in F1?', a: '2021' },
    { q: 'Which driver is nicknamed "The Iceman"?', a: 'Kimi Räikkönen' },
    { q: 'What is Ferrari\'s official racing colour?', a: 'Rosso Corsa (Racing Red)' },
    { q: 'What does "Box Box" mean over team radio?', a: 'Come in for a pit stop' },
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feign')
        .setDescription('🎭 Feign — Social deduction game! Find the impostor. (3-8 players)')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Start a new Feign game')
                .addIntegerOption(opt =>
                    opt.setName('lobby_time')
                        .setDescription('Lobby join duration in seconds (default: 60)')
                        .setMinValue(15)
                        .setMaxValue(120)
                )
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('Cancel the current game (Moderator only)')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'end') {
            if (!interaction.member.permissions.has('ManageMessages') && !require('../lib/perms').isOwner(interaction.user.id)) {
                return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }
            const game = activeGames.get(interaction.guildId);
            if (!game) return interaction.reply({ content: '❌ No active Feign game found.', ephemeral: true });
            activeGames.delete(interaction.guildId);
            return interaction.reply({ content: '🛑 Feign game has been cancelled.' });
        }

        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Feign game on this server!', ephemeral: true });
        }

        const joinTime = (interaction.options.getInteger('lobby_time') || 60) * 1000;
        const question = F1_QUESTIONS[Math.floor(Math.random() * F1_QUESTIONS.length)];

        const game = {
            hostId: interaction.user.id,
            players: new Set([interaction.user.id]),
            phase: 'lobby',
            question,
            answers: new Map(),
            votes: new Map(),
            feignerId: null,
        };
        activeGames.set(interaction.guildId, game);

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('feign_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('feign_begin').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🎭 FEIGN — Find the Impostor!')
            .setDescription(
                `**${interaction.user.displayName}** started a new game!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
                `*Minimum 3, maximum 8 players.*`
            )
            .addFields(
                { name: '⏱️ Lobby Time', value: `${joinTime / 1000}s`, inline: true },
                { name: '👥 Players', value: `${game.players.size}`, inline: true }
            )
            .setFooter({ text: 'Press ▶️ Start to begin early' });

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [joinRow], fetchReply: true });
        const collector = msg.createMessageComponentCollector({ time: joinTime });

        collector.on('collect', async i => {
            if (i.customId === 'feign_join') {
                if (game.players.has(i.user.id)) return i.reply({ content: '✅ You already joined!', ephemeral: true });
                if (game.players.size >= 8) return i.reply({ content: '❌ The game is full (max 8 players).', ephemeral: true });
                game.players.add(i.user.id);
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'feign_begin') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) {
                    return i.reply({ content: '❌ Only the host can start the game.', ephemeral: true });
                }
                if (game.players.size < 3) return i.reply({ content: '❌ At least 3 players required!', ephemeral: true });
                collector.stop('begin');
                await i.deferUpdate();
            }
        });

        collector.on('end', async () => {
            if (game.players.size < 3) {
                activeGames.delete(interaction.guildId);
                return msg.edit({
                    embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Feign cancelled — not enough players.')],
                    components: []
                });
            }
            await startGame(interaction, msg, game);
        });
    }
};

async function startGame(interaction, msg, game) {
    const players = [...game.players];
    game.feignerId = players[Math.floor(Math.random() * players.length)];
    game.phase = 'answer';

    const dmPromises = players.map(async id => {
        try {
            const isFeigner = id === game.feignerId;
            const user = await interaction.client.users.fetch(id);
            const roleEmbed = new EmbedBuilder()
                .setColor(isFeigner ? 0x8b0000 : 0x1e3a5f)
                .setTitle(isFeigner ? '🎭 You are the Feigner!' : '🔍 You are a Detective!')
                .setDescription(
                    isFeigner
                        ? `**Your mission:** Give a *wrong but convincing* answer to the question below. Don't get caught!\n\nThe other players will try to identify you.`
                        : `**Your mission:** Catch the impostor!\n\nAnswer the question correctly — your answer will be used to identify fakes.`
                )
                .addFields({ name: '❓ Question', value: game.question.q })
                .setFooter({ text: 'Type your answer in the game channel.' });
            await user.send({ embeds: [roleEmbed] });
        } catch (e) { /* DMs may be closed */ }
    });
    await Promise.all(dmPromises);

    const answerButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('feign_answer_open').setLabel('📝 Submit Answer').setStyle(ButtonStyle.Secondary)
    );

    const answerEmbed = () => new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🎭 FEIGN — Answer Phase!')
        .setDescription(`**❓ Question:**\n> ${game.question.q}\n\n**📝 Type your answer in this channel! (90 seconds)**\n\nVoting starts once everyone has submitted.`)
        .addFields({ name: '👥 Status', value: players.map(id => `<@${id}> ${game.answers.has(id) ? '✅' : '⏳'}`).join('\n') })
        .setFooter({ text: 'Roles sent via DM.' });

    await msg.edit({ embeds: [answerEmbed()], components: [answerButtons] });

    const answerCollector = msg.createMessageComponentCollector({
        filter: i => i.customId === 'feign_answer_open' && game.players.has(i.user.id),
        time: 90_000
    });
    answerCollector.on('collect', async i => {
        if (game.answers.has(i.user.id)) return i.reply({ content: '✅ You already submitted your answer!', ephemeral: true });
        await i.reply({ content: `📝 **Type your answer in this channel now!**`, ephemeral: true });
    });

    const chanCollector = interaction.channel.createMessageCollector({
        filter: m => game.players.has(m.author.id) && !game.answers.has(m.author.id) && game.phase === 'answer',
        time: 90_000
    });

    chanCollector.on('collect', async m => {
        game.answers.set(m.author.id, m.content.trim().substring(0, 200));
        await m.delete().catch(() => {});
        await msg.edit({ embeds: [answerEmbed()] });
        if ([...game.players].every(id => game.answers.has(id))) {
            chanCollector.stop('all_answered');
            answerCollector.stop('done');
        }
    });

    chanCollector.on('end', async () => {
        for (const id of players) {
            if (!game.answers.has(id)) {
                game.answers.set(id, id === game.feignerId ? '❓ (timed out)' : game.question.a);
            }
        }
        await startVoting(interaction, msg, game, players);
    });
}

async function startVoting(interaction, msg, game, players) {
    game.phase = 'voting';
    const shuffled = [...game.answers.entries()].sort(() => Math.random() - 0.5);
    const answerDisplay = shuffled.map(([id, ans], idx) => `**${String.fromCharCode(65 + idx)}.** ${ans}`).join('\n');

    const rows = [];
    let row = new ActionRowBuilder();
    shuffled.forEach(([id], idx) => {
        if (idx > 0 && idx % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`feign_vote_${id}`)
                .setLabel(String.fromCharCode(65 + idx))
                .setStyle(ButtonStyle.Primary)
        );
    });
    rows.push(row);

    const voteEmbed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle('🗳️ FEIGN — Vote! Who is the Impostor?')
        .setDescription(`**❓ Question:**\n> ${game.question.q}\n\n**Answers:**\n${answerDisplay}\n\n*Select the answer you think belongs to the Feigner!*`)
        .addFields({ name: '⏱️ Time Limit', value: '30 seconds' });

    await msg.edit({ embeds: [voteEmbed], components: rows });

    const voteCollector = msg.createMessageComponentCollector({
        filter: i => i.customId.startsWith('feign_vote_') && game.players.has(i.user.id),
        time: 30_000
    });

    voteCollector.on('collect', async i => {
        const targetId = i.customId.replace('feign_vote_', '');
        if (i.user.id === targetId) return i.reply({ content: '❌ You cannot vote for yourself!', ephemeral: true });
        if (game.votes.has(i.user.id)) return i.reply({ content: '✅ You already voted.', ephemeral: true });
        game.votes.set(i.user.id, targetId);
        await i.reply({ content: `✅ Vote recorded!`, ephemeral: true });
        if (game.votes.size >= players.length - 1) voteCollector.stop('all_voted');
    });

    voteCollector.on('end', async () => await showResults(interaction, msg, game, players, shuffled));
}

async function showResults(interaction, msg, game, players, shuffled) {
    game.phase = 'done';
    activeGames.delete(interaction.guildId);

    const tally = new Map();
    for (const targetId of game.votes.values()) tally.set(targetId, (tally.get(targetId) || 0) + 1);

    const mostVoted = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const feignerCaught = mostVoted && mostVoted[0] === game.feignerId;

    const answerReveal = shuffled.map(([id, ans], idx) => {
        const isFeigner = id === game.feignerId;
        const votes = tally.get(id) || 0;
        return `**${String.fromCharCode(65 + idx)}.** ${ans} — <@${id}> ${isFeigner ? '🎭 **FEIGNER**' : ''} ${votes > 0 ? `(${votes} vote${votes > 1 ? 's' : ''})` : ''}`;
    }).join('\n');

    const resultEmbed = new EmbedBuilder()
        .setColor(feignerCaught ? 0x00c851 : 0x8b0000)
        .setTitle(feignerCaught ? '🔍 Impostor caught!' : '🎭 Feigner wins!')
        .setDescription(
            `**❓ Question:** ${game.question.q}\n` +
            `**✅ Correct Answer:** ${game.question.a}\n\n` +
            `**🎭 Feigner:** <@${game.feignerId}>\n\n` +
            `**Answers & Votes:**\n${answerReveal}\n\n` +
            (feignerCaught ? `🎉 Detectives win! The impostor was exposed.` : `😈 Feigner got away with it! Winner: <@${game.feignerId}>`)
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [resultEmbed], components: [] });
}

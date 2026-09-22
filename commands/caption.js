// commands/caption.js — Caption This! (Scenario + Written Caption + Voting)
// The bot shares an F1 scenario. Players write the funniest caption.
// Voting determines the winner each round.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const SCENARIOS = [
    { scene: '🏎️ **Scenario:** Verstappen is in the pit box. The tyre crew isn\'t ready yet. Max is staring at the empty wheel arch thinking...', hint: 'Max\'s inner monologue 🧠' },
    { scene: '📻 **Scenario:** The race engineer comes on the radio: "Box box box!" — but the driver is still thinking about it...', hint: 'The hesitation 📻' },
    { scene: '🏆 **Scenario:** Podium ceremony. Champagne bottles are out. One driver is desperately trying NOT to get wet...', hint: 'The escape plan 🍾' },
    { scene: '🟡 **Scenario:** Safety car deployed. 20 cars crawling around the track. The thoughts running through every driver\'s head...', hint: 'Safety car suffering 🚗' },
    { scene: '⛽ **Scenario:** Pit stop complete — but the wheel gun is stuck. Mechanic panicking, driver waiting, crowd watching...', hint: 'Pit lane drama 🔧' },
    { scene: '🌧️ **Scenario:** Rain starts. Inter or slick? The pit wall is divided. Everyone\'s shouting at once...', hint: 'The wet weather debate 🌧️' },
    { scene: '🏁 **Scenario:** Checkered flag incoming — car breaks down half a metre from the line. Driver\'s expression...', hint: 'The last half metre 😱' },
    { scene: '📸 **Scenario:** Paparazzi catches a driver at the airport. Driver doesn\'t want to be photographed but the camera is already up...', hint: 'Airport spotted 📸' },
    { scene: '🤝 **Scenario:** Two rival drivers shake hands after the race. Both smiling. Both thinking completely different things...', hint: 'The fake handshake 🤝' },
    { scene: '🚨 **Scenario:** DRS opens, the driver goes for the overtake — DRS closes before they get past. Their face...', hint: 'DRS heartbreak 💨' },
    { scene: '🏎️ **Scenario:** Monaco narrow streets. Driver squeezing past a wall with literally 1mm of clearance remaining...', hint: 'Monaco parking 🅿️' },
    { scene: '🎤 **Scenario:** Post-race press conference. A journalist asks the most pointless question anyone has ever heard...', hint: 'Press conference pain 😅' },
    { scene: '🔧 **Scenario:** Mechanic working under the car. Driver leans in and asks something completely unnecessary right now...', hint: 'Garage moment 🔧' },
    { scene: '🏆 **Scenario:** Small backmarker team scores their first point ever. Half the garage is crying. What are they saying?', hint: 'First point 🥹' },
    { scene: '🎮 **Scenario:** Game Night kicks off. Everyone\'s ready. The bot returns an unexpected error message...', hint: 'bot crisis 🤖' },
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('caption')
        .setDescription('📝 Caption This! — Write the funniest caption, vote, win!')
        .addIntegerOption(opt =>
            opt.setName('rounds')
                .setDescription('Number of rounds (default: 3)')
                .setMinValue(1)
                .setMaxValue(8)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Caption game on this server!', ephemeral: true });
        }

        const totalRounds = interaction.options.getInteger('rounds') || 3;
        const scenarios = SCENARIOS.sort(() => Math.random() - 0.5).slice(0, totalRounds);

        const game = {
            hostId: interaction.user.id,
            players: new Set([interaction.user.id]),
            scores: new Map([[interaction.user.id, 0]]),
            round: 0,
            totalRounds,
            scenarios,
            phase: 'lobby',
            captions: new Map(),
            votes: new Map()
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('📝 CAPTION THIS!')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Players: ${[...game.players].map(id => `<@${id}>`).join(', ')}\n\n` +
                `📊 **${totalRounds} round${totalRounds > 1 ? 's' : ''}** — Each round a scenario drops, write the best caption!`
            )
            .setFooter({ text: 'Minimum 2 players required' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cap_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cap_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'cap_join') {
                if (game.players.has(i.user.id)) return i.reply({ content: '✅ Already joined!', ephemeral: true });
                game.players.add(i.user.id);
                game.scores.set(i.user.id, 0);
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'cap_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only the host can start.', ephemeral: true });
                if (game.players.size < 2) return i.reply({ content: '❌ At least 2 players required!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.players.size < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Caption cancelled.')], components: [] });
            }
            await runRound(interaction, msg, game);
        });
    }
};

async function runRound(interaction, msg, game) {
    if (game.round >= game.totalRounds) return endGame(interaction, msg, game);

    const scenario = game.scenarios[game.round];
    game.round++;
    game.captions.clear();
    game.votes.clear();
    game.phase = 'caption';

    const players = [...game.players];

    const writeEmbed = () => new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`📝 ROUND ${game.round}/${game.totalRounds} — Write Your Caption!`)
        .setDescription(
            `${scenario.scene}\n\n` +
            `💬 **${scenario.hint}**\n\n` +
            `*Type your caption in this channel! (60 seconds, max 200 characters)*\n\n` +
            `Status: ${players.map(id => `<@${id}> ${game.captions.has(id) ? '✅' : '⏳'}`).join(' | ')}`
        )
        .setFooter({ text: 'Type your caption in this channel.' });

    await msg.edit({ embeds: [writeEmbed()], components: [] });

    const writeCollector = interaction.channel.createMessageCollector({
        filter: m => game.players.has(m.author.id) && !game.captions.has(m.author.id) && game.phase === 'caption',
        time: 60_000
    });

    writeCollector.on('collect', async m => {
        if (m.content.length > 200) {
            const w = await m.reply({ content: '❌ Caption must be 200 characters or fewer!' });
            setTimeout(() => w.delete().catch(() => {}), 3000);
            return;
        }
        game.captions.set(m.author.id, m.content.trim());
        await m.delete().catch(() => {});
        await msg.edit({ embeds: [writeEmbed()] });
        if (game.captions.size >= players.length) writeCollector.stop('all');
    });

    writeCollector.on('end', async () => {
        if (game.captions.size === 0) {
            activeGames.delete(interaction.guildId);
            return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Nobody submitted a caption — game cancelled.')], components: [] });
        }
        await runVoting(interaction, msg, game, scenario, players);
    });
}

async function runVoting(interaction, msg, game, scenario, players) {
    game.phase = 'voting';
    const entries = [...game.captions.entries()].sort(() => Math.random() - 0.5);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const captionDisplay = entries.map(([id, cap], i) => `**${letters[i]}.** "${cap}"`).join('\n\n');

    const rows = [];
    let row = new ActionRowBuilder();
    entries.forEach(([id], i) => {
        if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(new ButtonBuilder().setCustomId(`cap_vote_${id}`).setLabel(letters[i]).setStyle(ButtonStyle.Primary));
    });
    rows.push(row);

    const voteEmbed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle(`🗳️ ROUND ${game.round} — Vote for the Best Caption!`)
        .setDescription(`${scenario.scene}\n\n${captionDisplay}`)
        .setFooter({ text: '20 seconds — you cannot vote for your own caption!' });

    await msg.edit({ embeds: [voteEmbed], components: rows });

    const voterMap = new Map();
    const voteCollector = msg.createMessageComponentCollector({
        filter: i => i.customId.startsWith('cap_vote_') && game.players.has(i.user.id),
        time: 20_000
    });

    voteCollector.on('collect', async i => {
        if (voterMap.has(i.user.id)) return i.reply({ content: '✅ Already voted!', ephemeral: true });
        const targetId = i.customId.replace('cap_vote_', '');
        if (targetId === i.user.id) return i.reply({ content: '❌ You cannot vote for your own caption!', ephemeral: true });
        voterMap.set(i.user.id, targetId);
        game.votes.set(i.user.id, targetId);
        await i.reply({ content: '✅ Vote recorded!', ephemeral: true });
        if (voterMap.size >= players.length) voteCollector.stop('all');
    });

    voteCollector.on('end', async () => {
        const tally = new Map();
        for (const targetId of game.votes.values()) tally.set(targetId, (tally.get(targetId) || 0) + 1);
        for (const [id, votes] of tally) game.scores.set(id, (game.scores.get(id) || 0) + votes * 2);

        const resultLines = entries
            .map(([id, cap], i) => ({ id, cap, letter: letters[i], votes: tally.get(id) || 0 }))
            .sort((a, b) => b.votes - a.votes)
            .map(({ id, cap, letter, votes }) => `**${letter}.** "${cap}" — <@${id}> (${votes} vote${votes !== 1 ? 's' : ''})`);

        const revealEmbed = new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle(`✅ ROUND ${game.round} RESULT`)
            .setDescription(`${scenario.scene}\n\n**Captions & Votes:**\n${resultLines.join('\n\n')}`)
            .addFields({
                name: '📊 Scoreboard',
                value: [...game.scores.entries()].sort((a, b) => b[1] - a[1]).map(([id, pts], i) => `${['🥇','🥈','🥉'][i] || `${i + 1}.`} <@${id}> — ${pts}pts`).join('\n')
            });

        await msg.edit({ embeds: [revealEmbed], components: [] });
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
        .setTitle('🏆 CAPTION THIS — Final Results')
        .setDescription(
            `🎉 **Winner: <@${winner[0]}>** — **${winner[1]} points**\n\n` +
            final.map(([id, pts], i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} <@${id}> — ${pts} pts`).join('\n')
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

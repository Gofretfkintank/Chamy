// commands/dragrace.js — Drag Race (Speed Race / Live Progress Bar)
// Players mash the "GAS!" button to advance their car along the track.
// First to the finish line wins. Progress bar updates live.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const TRACK_LENGTH = 20;
const BOOST_CHANCE = 0.15;   // 15% chance: advance +3 instead of +1
const SLIP_CHANCE  = 0.08;   // 8% chance: slide back -1
const UPDATE_INTERVAL = 800; // ms between embed refreshes

const CAR_EMOJIS = ['🔴', '🟡', '🟢', '🔵', '🟣', '🟠', '⚪', '🟤'];

const activeRaces = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dragrace')
        .setDescription('🏎️ Drag Race — Mash the button, move your car, cross the line first!')
        .addIntegerOption(opt =>
            opt.setName('duration')
                .setDescription('Race duration in seconds (default: 30)')
                .setMinValue(15)
                .setMaxValue(60)
        ),

    async execute(interaction) {
        if (activeRaces.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Drag Race on this server!', ephemeral: true });
        }

        const raceDuration = (interaction.options.getInteger('duration') || 30) * 1000;

        const game = {
            phase: 'lobby',
            racers: new Map(),
            winner: null,
            startTime: null
        };
        activeRaces.set(interaction.guildId, game);

        game.racers.set(interaction.user.id, {
            name: interaction.member?.displayName || interaction.user.username,
            pos: 0,
            emoji: CAR_EMOJIS[0],
            boosts: 0,
            slips: 0
        });

        const buildTrack = () => {
            const lines = [];
            for (const [id, racer] of game.racers) {
                const pos = Math.min(racer.pos, TRACK_LENGTH);
                const filled = '▰'.repeat(pos);
                const empty  = '▱'.repeat(Math.max(0, TRACK_LENGTH - pos));
                lines.push(`${racer.emoji} ${filled}${empty} 🏁  **${racer.name}**`);
            }
            return lines.join('\n');
        };

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🏎️ DRAG RACE — Ready Up!')
            .setDescription(
                `Racers:\n${[...game.racers.values()].map(r => `${r.emoji} ${r.name}`).join('\n')}\n\n` +
                `**Duration:** ${raceDuration / 1000}s | **Track Length:** ${TRACK_LENGTH} units\n\n` +
                `💡 Mash **GAS!** to move. Boosts (+3) and slips (-1) happen randomly!`
            )
            .setFooter({ text: 'Press Join to race, host presses Start!' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dr_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('dr_start').setLabel('🏁 Start!').setStyle(ButtonStyle.Danger)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'dr_join') {
                if (game.racers.has(i.user.id)) return i.reply({ content: '✅ Already joined!', ephemeral: true });
                if (game.racers.size >= 8) return i.reply({ content: '❌ Race is full (max 8 racers)!', ephemeral: true });
                game.racers.set(i.user.id, {
                    name: i.member?.displayName || i.user.username,
                    pos: 0,
                    emoji: CAR_EMOJIS[game.racers.size % CAR_EMOJIS.length],
                    boosts: 0,
                    slips: 0
                });
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'dr_start') {
                if (!require('../lib/perms').canControlGame(i, interaction.user.id)) {
                    return i.reply({ content: '❌ Only the host can start the race.', ephemeral: true });
                }
                if (game.racers.size < 2) return i.reply({ content: '❌ At least 2 racers required!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.racers.size < 2) {
                activeRaces.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Race cancelled.')], components: [] });
            }
            await startRace(interaction, msg, game, raceDuration, buildTrack);
        });
    }
};

async function startRace(interaction, msg, game, raceDuration, buildTrack) {
    game.phase = 'racing';

    for (let i = 3; i >= 1; i--) {
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0xcc0000).setTitle(`🔴 Get ready... ${i}`).setDescription(buildTrack())],
            components: []
        });
        await new Promise(r => setTimeout(r, 1000));
    }

    game.startTime = Date.now();
    const gasRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dr_gas').setLabel('⛽ GAS!').setStyle(ButtonStyle.Danger)
    );

    await msg.edit({
        embeds: [new EmbedBuilder().setColor(0x00c851).setTitle('🟢 GO GO GO!').setDescription(buildTrack()).setFooter({ text: `${raceDuration / 1000}s — first to the finish line wins!` })],
        components: [gasRow]
    });

    const gasCollector = msg.createMessageComponentCollector({
        filter: i => i.customId === 'dr_gas' && game.racers.has(i.user.id),
        time: raceDuration
    });

    gasCollector.on('collect', async i => {
        if (game.phase !== 'racing') return i.deferUpdate();
        const racer = game.racers.get(i.user.id);
        const roll = Math.random();
        if (roll < BOOST_CHANCE) { racer.pos = Math.min(racer.pos + 3, TRACK_LENGTH + 1); racer.boosts++; }
        else if (roll < BOOST_CHANCE + SLIP_CHANCE) { racer.pos = Math.max(racer.pos - 1, 0); racer.slips++; }
        else { racer.pos = Math.min(racer.pos + 1, TRACK_LENGTH + 1); }
        await i.deferUpdate();
        if (racer.pos >= TRACK_LENGTH && !game.winner) {
            game.winner = i.user.id;
            game.phase = 'done';
            gasCollector.stop('winner');
        }
    });

    const updateInterval = setInterval(async () => {
        if (game.phase !== 'racing') return clearInterval(updateInterval);
        const remaining = Math.max(0, Math.ceil((raceDuration - (Date.now() - game.startTime)) / 1000));
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0xf5c518).setTitle('🏎️ DRAG RACE — In Progress!').setDescription(buildTrack()).setFooter({ text: `⏱️ ${remaining}s remaining` })],
            components: [gasRow]
        }).catch(() => {});
    }, UPDATE_INTERVAL);

    gasCollector.on('end', async () => {
        clearInterval(updateInterval);
        activeRaces.delete(interaction.guildId);

        const sorted = [...game.racers.entries()].sort((a, b) => b[1].pos - a[1].pos);
        const winnerId = game.winner || sorted[0][0];
        const winner = game.racers.get(winnerId);

        const leaderboard = sorted.map(([id, r], i) => {
            const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
            const pct = Math.min(100, Math.round((r.pos / TRACK_LENGTH) * 100));
            return `${medal} ${r.emoji} **${r.name}** — ${pct}% (${r.pos}/${TRACK_LENGTH}) | ⚡${r.boosts} boost${r.boosts !== 1 ? 's' : ''} 💨${r.slips} slip${r.slips !== 1 ? 's' : ''}`;
        });

        const finalEmbed = new EmbedBuilder()
            .setColor(0xf5c518)
            .setTitle('🏆 RACE OVER!')
            .setDescription(
                `🎉 **Winner: ${winner.emoji} ${winner.name}** <@${winnerId}>\n\n` +
                `**Track:**\n${buildTrack()}\n\n` +
                `**Final Standings:**\n${leaderboard.join('\n')}`
            )
            .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

        await msg.edit({ embeds: [finalEmbed], components: [] });
    });
}

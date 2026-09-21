// commands/hungergames.js — Hunger Games (Auto Story Simulation)

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// Event templates
const DAY_EVENTS = [
    '{0} finds a set of fresh tyres in the Supply Cache and bolts.',
    '{0} and {1} form a temporary alliance at the Paddock.',
    '{0} sets a DRS trap, luring {1} into a gravel trap.',
    '{0} discovers a tyre blowout kit and repairs their advantage.',
    '{0} hides inside the Safety Car and waits for sunset.',
    '{0} and {1} argue over the fastest racing line and part ways.',
    '{0} discovers the secret fuel depot but loses it to {1}.',
    '{0} spots a red flag and uses the delay to restock.',
    '{0} chases {1} through the chicane but loses them.',
    '{0} finds a fresh set of mediums. Confidence rises.',
    '{0} attempts an undercut but {1} responds with fresh tyres.',
    '{0} and {1} agree to share the tyre allocation.',
    '{0} takes the long way around Sector 3 to avoid {1}.',
    '{0} triggers a virtual safety car by leaving debris on track.',
    '{0} receives a mystery box from the sponsors.',
    '{0} and {1} clash on the exit of Turn 1. Both escape.',
    '{0} sets the fastest lap of the day, boosting morale.',
    '{0} stumbles across {1}\'s hidden tyre stash.',
    '{0} attempts a bold overtake but {1} closes the door.',
    '{0} crafts a decoy strategy to throw off rivals.',
];

const KILL_EVENTS = [
    '{0} forces {1} into the wall. {1} is eliminated.',
    '{0} deploys a KERS boost and outpaces {1}, who crashes out.',
    '{0} triggers {1}\'s retirement with a well-timed squeeze.',
    '{0} overtakes {1} at full speed — {1} spins and is out.',
    '{0} and {1} collide at the hairpin. {1} doesn\'t make it back.',
    '{0} cuts off {1}\'s line at the apex. {1} is done.',
    '{0} sends {1} into the gravel on the main straight.',
    '{0} executes a perfect defensive block, sending {1} into the barriers.',
    '{0} uses a tyre blowout device on {1}. {1} retires.',
    '{0} lures {1} off the optimal line — {1} can\'t recover.',
];

const NIGHT_EVENTS = [
    '{0} sleeps soundly under the pitwall.',
    '{0} and {1} plot their next move in the garage.',
    '{0} quietly sabotages {1}\'s front wing.',
    '{0} is awake all night, paranoid about {1}.',
    '{0} dreams of standing on the podium.',
    '{0} secretly contacts a sponsor for extra resources.',
    '{0} spots {1} sneaking through the night paddock.',
    '{0} sets up a tripwire near the pit lane exit.',
    '{0} and {1} share a moment of uneasy peace.',
];

const FINAL_EVENTS = [
    '{0} and {1} face each other in the final corner. Only one survives.',
    '{0} hunts down {1} in the final lap. {1} is the last to fall.',
    '{0} outwits {1} in a tense final-lap battle. {1} is eliminated.',
    'The arena shakes as {0} and {1} go wheel to wheel. {0} comes out on top.',
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hungergames')
        .setDescription('⚔️ Hunger Games — Enter as tributes, watch the story unfold!')
        .addIntegerOption(opt =>
            opt.setName('delay')
                .setDescription('Seconds between event messages (default: 4)')
                .setMinValue(2)
                .setMaxValue(10)
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Hunger Games on this server!', ephemeral: true });
        }

        const delay = (interaction.options.getInteger('delay') || 4) * 1000;

        const game = {
            hostId: interaction.user.id,
            tributes: [{ userId: interaction.user.id, name: interaction.member?.displayName || interaction.user.username, alive: true }],
            phase: 'lobby',
            day: 0
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('⚔️ HUNGER GAMES — F1 Arena')
            .setDescription(
                `**Welcome to the Arena!**\n\n` +
                `Tributes so far:\n${game.tributes.map((t, i) => `${i + 1}. **${t.name}**`).join('\n')}\n\n` +
                `Only **one** will survive.\n\n` +
                `The simulation runs automatically — sit back and watch!`
            )
            .setFooter({ text: 'Press Join to enter as a tribute, host presses Start' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('hg_join').setLabel('⚔️ Enter as Tribute').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('hg_start').setLabel('▶️ Begin').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 90_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'hg_join') {
                if (game.tributes.find(t => t.userId === i.user.id)) return i.reply({ content: '✅ Already a tribute!', ephemeral: true });
                if (game.tributes.length >= 24) return i.reply({ content: '❌ Arena full (max 24 tributes).', ephemeral: true });
                game.tributes.push({ userId: i.user.id, name: i.member?.displayName || i.user.username, alive: true });
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'hg_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only host can start.', ephemeral: true });
                if (game.tributes.length < 2) return i.reply({ content: '❌ At least 2 tributes needed!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.tributes.length < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Hunger Games cancelled.')], components: [] });
            }
            game.phase = 'running';
            await runSimulation(interaction, msg, game, delay);
        });
    }
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function formatEvent(template, actor, target) {
    return template
        .replaceAll('{0}', `**${actor.name}**`)
        .replaceAll('{1}', target ? `**${target.name}** ` : '**someone**');
}

function alive(game) { return game.tributes.filter(t => t.alive); }

async function runSimulation(interaction, msg, game, delay) {
    await msg.edit({ 
        embeds: [
            new EmbedBuilder()
                .setColor(0x8b0000)
                .setTitle('🔫 THE CORNUCOPIA!')
                .setDescription(`The tributes scatter! ${alive(game).length} enter the arena...\n\n${alive(game).map(t => `⚔️ **${t.name}**`).join('\n')}`)
                .setFooter({ text: 'Let the games begin.' })
        ], 
        components: [] 
    });
    await new Promise(r => setTimeout(r, delay));

    const bloodbathKills = Math.max(0, Math.floor(alive(game).length * 0.2));
    const openLog = ['**⚡ OPENING BLOODBATH:**'];
    for (let k = 0; k < bloodbathKills; k++) {
        const survivors = alive(game);
        if (survivors.length <= 2) break;
        const victim = pick(survivors);
        const killer = pick(survivors.filter(t => t.userId !== victim.userId));
        victim.alive = false;
        openLog.push(`☠️ ${formatEvent(pick(KILL_EVENTS), killer, victim)}`);
    }
    openLog.push(`\n*${alive(game).length} tributes survive the opening.*`);

    await sendLog(interaction.channel, openLog.join('\n'), 0x8b0000);
    await new Promise(r => setTimeout(r, delay));

    while (alive(game).length > 1) {
        game.day++;
        const isNight = game.day % 2 === 0;
        const log = [`**${isNight ? '🌙 NIGHT' : '☀️ DAY'} ${Math.ceil(game.day / 2)}:**`];

        const survivors = alive(game);

        const eventCount = Math.max(1, Math.floor(survivors.length * 0.6));
        for (let e = 0; e < eventCount; e++) {
            const actor = pick(survivors);
            const others = survivors.filter(t => t.userId !== actor.userId);
            const target = others.length ? pick(others) : null;
            const templates = isNight ? NIGHT_EVENTS : DAY_EVENTS;
            log.push(`• ${formatEvent(pick(templates), actor, target)}`);
        }

        const killCount = Math.max(1, Math.floor(survivors.length * 0.25));
        for (let k = 0; k < killCount; k++) {
            const current = alive(game);
            if (current.length <= 2) break;
            const victim = pick(current);
            const killer = pick(current.filter(t => t.userId !== victim.userId));
            victim.alive = false;
            log.push(`☠️ ${formatEvent(pick(KILL_EVENTS), killer, victim)}`);
        }

        const fallen = game.tributes.filter(t => !t.alive && t._announced !== true);
        if (fallen.length) {
            log.push(`\n**☠️ Fallen this ${isNight ? 'night' : 'day'}:** ${fallen.map(t => t.name).join(', ')}`);
            fallen.forEach(t => t._announced = true);
        }
        log.push(`\n*${alive(game).length} remain.*`);

        const color = isNight ? 0x1e3a5f : 0xf5c518;
        await sendLog(interaction.channel, log.join('\n'), color);
        await new Promise(r => setTimeout(r, delay * 1.5));
    }

    const [winner] = alive(game);
    const runnerUp = game.tributes.filter(t => t.userId !== winner.userId).pop();

    if (runnerUp) {
        const finalEvent = formatEvent(pick(FINAL_EVENTS), winner, runnerUp);
        await sendLog(interaction.channel, `**🏆 FINAL BATTLE:**\n${finalEvent}`, 0x8b0000);
        await new Promise(r => setTimeout(r, delay));
    }

    activeGames.delete(interaction.guildId);

    const winnerEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 WINNER OF THE HUNGER GAMES!')
        .setDescription(
            `🎉 **${winner.name}** <@${winner.userId}> is the last tribute standing!\n\n` +
            `**Final standings:**\n` +
            `${game.tributes.map((t, i) => `${t.alive ? '🏆' : '☠️'} **${t.name}**`).reverse().join('\n')}`
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [winnerEmbed], components: [] });
}

async function sendLog(channel, text, color) {
    const chunks = [];
    const lines = text.split('\n');
    let chunk = '';
    for (const line of lines) {
        if ((chunk + '\n' + line).length > 1900) { chunks.push(chunk); chunk = line; }
        else chunk += (chunk ? '\n' : '') + line;
    }
    if (chunk) chunks.push(chunk);

    for (const c of chunks) {
        await channel.send({ embeds: [new EmbedBuilder().setColor(color).setDescription(c)] });
    }
}

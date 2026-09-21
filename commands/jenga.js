// commands/jenga.js — Jenga (Balance & Probability)
// Players take turns pulling blocks. Each block has a stability rating.
// Pulling a risky block might topple the tower. Last player standing wins.
// Includes challenge blocks with special effects.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// Tower is 18 levels, 3 blocks each. Each block: { pulled, risk }
const LEVELS = 18;
const BLOCKS_PER_LEVEL = 3;

// Challenge effects on special blocks
const CHALLENGES = [
    'Use only one hand for your next pull.',
    'Pull with your eyes closed (honour system).',
    'Give 1 risk point to another player of your choice.',
    'Swap your risk score with another player.',
    'Skip your next turn — you\'re too nervous.',
    'Everyone else must remove a block this round.',
    'Tell the group your go-to overtaking move.',
    'Pull two blocks instead of one this turn.',
    'Reset your own risk to 0 — lucky escape!',
    'The most nervous-looking player must pull next instead of you.',
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jenga')
        .setDescription('🧱 Jenga — Pull blocks without toppling the tower! (2-8 players)')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Start a new Jenga game')
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End the current game (Moderator)')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'end') {
            if (!interaction.member.permissions.has('ManageMessages') && !require('../lib/perms').isOwner(interaction.user.id)) {
                return interaction.reply({ content: '❌ No permission.', ephemeral: true });
            }
            activeGames.delete(interaction.guildId);
            return interaction.reply({ content: '🛑 Jenga ended.' });
        }

        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Jenga game on this server!', ephemeral: true });
        }

        const game = {
            hostId: interaction.user.id,
            phase: 'lobby',
            players: [],       // { userId, name, risk, out }
            tower: buildTower(),
            height: LEVELS,    // levels still standing
            turn: 0,
            collapsed: false
        };
        activeGames.set(interaction.guildId, game);

        game.players.push({ userId: interaction.user.id, name: interaction.member?.displayName || interaction.user.username, risk: 0, out: false });

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🧱 JENGA — Pull Without Toppling!')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Players: ${game.players.map(p => p.name).join(', ')}\n\n` +
                `The tower has **${LEVELS} levels** × ${BLOCKS_PER_LEVEL} blocks.\n` +
                `🔴 High-risk blocks may collapse the tower!\n` +
                `🃏 Some blocks have challenge effects.`
            )
            .setFooter({ text: 'Press Join then host presses Start' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('jng_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('jng_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 60_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'jng_join') {
                if (game.players.find(p => p.userId === i.user.id)) return i.reply({ content: '✅ Already joined!', ephemeral: true });
                if (game.players.length >= 8) return i.reply({ content: '❌ Game full (max 8).', ephemeral: true });
                game.players.push({ userId: i.user.id, name: i.member?.displayName || i.user.username, risk: 0, out: false });
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'jng_start') {
                if (i.user.id !== game.hostId && i.user.id !== '1097807544849809408') return i.reply({ content: '❌ Only host can start.', ephemeral: true });
                if (game.players.length < 2) return i.reply({ content: '❌ At least 2 players needed!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async () => {
            if (game.players.length < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Jenga cancelled.')], components: [] });
            }
            game.phase = 'playing';
            await doTurn(interaction, msg, game);
        });
    }
};

function buildTower() {
    const tower = [];
    for (let lvl = 0; lvl < LEVELS; lvl++) {
        const level = [];
        for (let b = 0; b < BLOCKS_PER_LEVEL; b++) {
            // Risk: bottom levels safer, top levels riskier
            const baseRisk = Math.floor((lvl / LEVELS) * 60) + 10;
            const isChallenge = Math.random() < 0.1;
            level.push({ pulled: false, risk: baseRisk + Math.floor(Math.random() * 20), challenge: isChallenge });
        }
        tower.push(level);
    }
    return tower;
}

function renderTower(tower, highlightLevel = -1, highlightBlock = -1) {
    const lines = [];
    const top = Math.min(tower.length - 1, highlightLevel + 4);
    const bot = Math.max(0, highlightLevel - 4);
    for (let lvl = Math.min(top, tower.length - 1); lvl >= Math.max(0, bot); lvl--) {
        const level = tower[lvl];
        const blocks = level.map((b, bi) => {
            if (b.pulled) return '  ';
            if (lvl === highlightLevel && bi === highlightBlock) return '🟥';
            if (b.challenge) return '🟨';
            const risk = b.risk;
            if (risk < 30) return '🟩';
            if (risk < 55) return '🟧';
            return '🟥';
        });
        lines.push(`L${String(lvl + 1).padStart(2, '0')}: ${blocks.join('')}`);
    }
    return lines.join('\n') || '*(tower collapsed)*';
}

function getAvailableBlocks(tower) {
    const available = [];
    for (let lvl = 0; lvl < tower.length; lvl++) {
        const level = tower[lvl];
        const remaining = level.filter(b => !b.pulled).length;
        if (remaining < 1) continue;
        for (let b = 0; b < BLOCKS_PER_LEVEL; b++) {
            if (!level[b].pulled) available.push({ lvl, b, risk: level[b].risk, challenge: level[b].challenge });
        }
    }
    return available;
}

function collapseChance(tower, lvl, b) {
    const block = tower[lvl][b];
    const remaining = tower[lvl].filter(x => !x.pulled).length;
    // If only 1 block left in level: very risky to pull it
    const bonus = remaining === 1 ? 30 : 0;
    return Math.min(95, block.risk + bonus);
}

async function doTurn(interaction, msg, game) {
    const active = game.players.filter(p => !p.out);
    if (active.length <= 1) return endGame(interaction, msg, game);

    const player = active[game.turn % active.length];

    const available = getAvailableBlocks(game.tower);
    if (available.length === 0) return endGame(interaction, msg, game);

    // Offer 3 random block choices (low/medium/high risk)
    const sorted = [...available].sort((a, b) => a.risk - b.risk);
    const choices = [
        sorted[0],
        sorted[Math.floor(sorted.length / 2)],
        sorted[sorted.length - 1]
    ].filter(Boolean);

    // Deduplicate
    const seen = new Set();
    const uniqueChoices = choices.filter(c => { const k = `${c.lvl}_${c.b}`; if (seen.has(k)) return false; seen.add(k); return true; });

    const riskLabel = (r) => r < 30 ? '🟩 Safe' : r < 55 ? '🟧 Risky' : '🟥 Dangerous';

    const choiceRow = new ActionRowBuilder().addComponents(
        uniqueChoices.map((c, i) =>
            new ButtonBuilder()
                .setCustomId(`jng_pull_${c.lvl}_${c.b}`)
                .setLabel(`L${c.lvl + 1}-${['A','B','C'][c.b]} ${riskLabel(c.risk)}${c.challenge ? ' 🃏' : ''}`)
                .setStyle(c.risk < 30 ? ButtonStyle.Success : c.risk < 55 ? ButtonStyle.Primary : ButtonStyle.Danger)
        )
    );

    const towerView = renderTower(game.tower);
    const riskBoard = game.players.map(p => `${p.out ? '💀' : '🧱'} **${p.name}** — risk: ${p.risk}`).join('\n');

    const turnEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🧱 ${player.name}'s Turn — Choose a Block!`)
        .setDescription(
            `**Tower (excerpt):**\n${towerView}\n\n` +
            `🟩 Safe  🟧 Risky  🟥 Dangerous  🟨 Challenge\n\n` +
            `**Player Risk:**\n${riskBoard}`
        )
        .setFooter({ text: `Turn ${game.turn + 1} | ${active.length} players remaining` });

    await msg.edit({ embeds: [turnEmbed], components: [choiceRow] });

    const collector = msg.createMessageComponentCollector({
        filter: i => i.customId.startsWith('jng_pull_') && i.user.id === player.userId,
        time: 45_000,
        max: 1
    });

    collector.on('collect', async i => {
        await i.deferUpdate();
        const parts = i.customId.split('_');
        const lvl = parseInt(parts[2]);
        const b   = parseInt(parts[3]);
        const block = game.tower[lvl][b];
        const chance = collapseChance(game.tower, lvl, b);
        const roll = Math.random() * 100;
        const collapsed = roll < chance;
        let eventText = '';

        if (collapsed) {
            game.collapsed = true;
            block.pulled = true;
            player.out = true;
            eventText = `💥 **THE TOWER COLLAPSED!** ${player.name} pulled the wrong block!\nCollapse chance was **${chance}%** — rolled **${roll.toFixed(0)}**.`;
        } else {
            block.pulled = true;
            player.risk += Math.floor(chance / 4);
            if (block.challenge) {
                const ch = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
                eventText = `✅ Block pulled safely!\n🃏 **Challenge:** ${ch}\nCollapse chance was ${chance}%.`;
            } else {
                eventText = `✅ Block pulled safely! Collapse chance was **${chance}%**. Rolled ${roll.toFixed(0)}.`;
            }
        }

        const active2 = game.players.filter(p => !p.out);
        const riskBoard2 = game.players.map(p => `${p.out ? '💀' : '🧱'} **${p.name}** — risk: ${p.risk}`).join('\n');

        const resultEmbed = new EmbedBuilder()
            .setColor(collapsed ? 0x8b0000 : 0x00c851)
            .setTitle(collapsed ? `💥 TOWER COLLAPSED!` : `✅ Block Removed Successfully`)
            .setDescription(`${eventText}\n\n**Tower:**\n${renderTower(game.tower, lvl, b)}\n\n**Player Risk:**\n${riskBoard2}`)
            .setFooter({ text: `${active2.length} players still standing` });

        await msg.edit({ embeds: [resultEmbed], components: [] });

        if (collapsed || active2.length <= 1) {
            await new Promise(r => setTimeout(r, 2000));
            return endGame(interaction, msg, game);
        }

        game.turn++;
        await new Promise(r => setTimeout(r, 3500));
        await doTurn(interaction, msg, game);
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            // Auto-pull lowest risk block
            const safe = available.sort((a, b) => a.risk - b.risk)[0];
            if (safe) {
                game.tower[safe.lvl][safe.b].pulled = true;
                await interaction.channel.send({ content: `⏰ **${player.name}** took too long! Auto-pulled the safest block.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }
            game.turn++;
            await doTurn(interaction, msg, game);
        }
    });
}

async function endGame(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const survivors = game.players.filter(p => !p.out).sort((a, b) => a.risk - b.risk);
    const loser = game.players.find(p => p.out);

    const finalEmbed = new EmbedBuilder()
        .setColor(game.collapsed ? 0x8b0000 : 0xf5c518)
        .setTitle(game.collapsed ? '💥 TOWER COLLAPSED — Game Over!' : '🧱 Jenga Complete!')
        .setDescription(
            (loser ? `💥 **${loser.name}** toppled the tower!\n\n` : '') +
            (survivors.length ? `🏆 **Winner: ${survivors[0].name}** — survived with risk score ${survivors[0].risk}\n\n` : '') +
            game.players.map((p, i) => {
                const medal = p.out ? '💀' : ['🥇', '🥈', '🥉'][i] || '🧱';
                return `${medal} **${p.name}** — risk: ${p.risk}${p.out ? ' *(knocked out)*' : ''}`;
            }).join('\n')
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

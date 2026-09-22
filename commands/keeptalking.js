// commands/keeptalking.js — Keep Talking and Nobody Explodes (Co-op Bomb Defusal)
// One player is the "Defuser" — they see the bomb modules but not the manual.
// Other players are "Experts" — they see the manual but not the bomb.
// They must communicate to defuse before the timer runs out.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');

// ── Module types ─────────────────────────────────────────────────────────────
const MODULE_TYPES = ['wires', 'button', 'keypad', 'simon', 'memory'];

// ── Wire colours ──────────────────────────────────────────────────────────────
const WIRE_COLORS = ['🔴 Red', '🔵 Blue', '🟡 Yellow', '⚫ Black', '⚪ White', '🟢 Green'];

function generateWireModule() {
    const count = Math.floor(Math.random() * 3) + 4; // 4-6 wires
    const wires = Array.from({ length: count }, () => WIRE_COLORS[Math.floor(Math.random() * WIRE_COLORS.length)]);
    // Rule: cut the last wire of a given condition
    const rules = [
        { condition: 'No red wires', solution: `Cut wire #${count}` },
        { condition: 'Exactly one red wire', solution: 'Cut wire #1' },
        { condition: 'More than one yellow wire and no red', solution: `Cut the last yellow wire` },
        { condition: 'Exactly one blue wire and more than one yellow', solution: `Cut wire #1` },
        { condition: 'More than one blue wire', solution: `Cut the last blue wire` },
    ];
    const rule = rules[Math.floor(Math.random() * rules.length)];
    return { type: 'wires', wires, manual: `**Wire Rule:** ${rule.condition} → ${rule.solution}`, answer: rule.solution };
}

function generateButtonModule() {
    const colors = ['Red', 'Blue', 'Yellow', 'White', 'Black'];
    const labels = ['ABORT', 'DETONATE', 'HOLD', 'PRESS', 'OK'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const label = labels[Math.floor(Math.random() * labels.length)];
    const solutions = [
        { cond: `Button is Blue and says "${label}"`, action: 'Press and immediately release.' },
        { cond: `Button is Red and says "HOLD"`, action: 'Hold the button. Release when the timer shows a 4.' },
        { cond: `Button is Yellow`, action: 'Hold the button. Release when the timer shows a 5.' },
        { cond: `Button is White`, action: 'Hold the button. Release when the timer shows a 1.' },
        { cond: `Otherwise`, action: 'Press and immediately release.' },
    ];
    const rule = solutions[Math.floor(Math.random() * solutions.length)];
    return {
        type: 'button',
        display: `Color: **${color}** | Label: **${label}**`,
        manual: `**Button Rule:** ${rule.cond} → ${rule.action}`,
        answer: rule.action
    };
}

function generateKeypadModule() {
    const symbols = ['Ω', '★', '©', '¶', '€', '£', '¥', '§', 'Δ', 'Ψ', 'Λ', 'Σ'];
    const shown = [];
    while (shown.length < 4) {
        const s = symbols[Math.floor(Math.random() * symbols.length)];
        if (!shown.includes(s)) shown.push(s);
    }
    const order = [...shown].sort(() => Math.random() - 0.5);
    return {
        type: 'keypad',
        display: `Symbols on keypad: **${shown.join('  ')}**`,
        manual: `**Keypad Rule:** Press symbols in this order: **${order.join(' → ')}**`,
        answer: order.join(' → ')
    };
}

function generateSimonModule() {
    const colors = ['🔴', '🔵', '🟡', '🟢'];
    const sequence = Array.from({ length: 4 }, () => colors[Math.floor(Math.random() * colors.length)]);
    // Map with a serial-number rule for simplicity
    const responseMap = { '🔴': '🔵', '🔵': '🔴', '🟡': '🟢', '🟢': '🟡' };
    const response = sequence.map(c => responseMap[c]);
    return {
        type: 'simon',
        display: `Simon flashes: **${sequence.join(' ')}**`,
        manual: `**Simon Rule:** No vowels in serial → Red→Blue, Blue→Red, Yellow→Green, Green→Yellow\nPress: **${response.join(' ')}**`,
        answer: response.join(' ')
    };
}

function generateMemoryModule() {
    const display = Math.floor(Math.random() * 4) + 1;
    const positions = [1, 2, 3, 4];
    const labels = positions.sort(() => Math.random() - 0.5);
    const rules = [
        { stage: 1, cond: `Display shows ${display}`, action: `Press position ${display}` },
        { stage: 1, cond: `Display shows 2`, action: 'Press the button labelled 4' },
        { stage: 1, cond: `Display shows 3`, action: 'Press position 3' },
    ];
    const rule = rules[Math.floor(Math.random() * rules.length)];
    return {
        type: 'memory',
        display: `Memory display: **${display}** | Buttons: **${labels.join('  ')}**`,
        manual: `**Memory Rule:** ${rule.cond} → ${rule.action}`,
        answer: rule.action
    };
}

function generateModule() {
    const type = MODULE_TYPES[Math.floor(Math.random() * MODULE_TYPES.length)];
    const generators = { wires: generateWireModule, button: generateButtonModule, keypad: generateKeypadModule, simon: generateSimonModule, memory: generateMemoryModule };
    return generators[type]();
}

const DIFFICULTY = {
    easy:   { modules: 2, time: 180 },
    medium: { modules: 3, time: 150 },
    hard:   { modules: 4, time: 120 },
};

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('keeptalking')
        .setDescription('💣 Keep Talking — Co-op bomb defusal! One defuser, the rest are experts.')
        .addStringOption(opt =>
            opt.setName('difficulty')
                .setDescription('Bomb difficulty (default: medium)')
                .addChoices(
                    { name: '🟢 Easy (2 modules, 3 min)', value: 'easy' },
                    { name: '🟡 Medium (3 modules, 2:30)', value: 'medium' },
                    { name: '🔴 Hard (4 modules, 2 min)', value: 'hard' }
                )
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active bomb on this server!', ephemeral: true });
        }

        const diff = DIFFICULTY[interaction.options.getString('difficulty') || 'medium'];
        const modules = Array.from({ length: diff.modules }, generateModule);

        const game = {
            hostId: interaction.user.id,
            phase: 'lobby',
            players: new Set([interaction.user.id]),
            defuserId: null,
            modules,
            solved: Array(diff.modules).fill(false),
            strikes: 0,
            maxStrikes: 3,
            timeLimit: diff.time,
            startTime: null,
            timerInterval: null,
            currentModule: 0
        };
        activeGames.set(interaction.guildId, game);

        const lobbyEmbed = new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('💣 KEEP TALKING AND NOBODY EXPLODES')
            .setDescription(
                `**${interaction.user.displayName}** is arming a bomb!\n\n` +
                `**${diff.modules} modules** | **${diff.time}s** to defuse | **${game.maxStrikes} strikes** allowed\n\n` +
                `Join to become an **Expert** (you see the manual, not the bomb).\n` +
                `The last person to join will be the **Defuser** (sees the bomb, not the manual).\n\n` +
                `Press **Ready** when everyone has joined.`
            )
            .setFooter({ text: 'Minimum 2 players — 1 Defuser + at least 1 Expert' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('kt_join').setLabel('🎮 Join as Expert').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('kt_defuse').setLabel('💣 I\'ll Defuse').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('kt_start').setLabel('▶️ Ready!').setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed], components: [lobbyRow], fetchReply: true });
        const lobbyCollector = msg.createMessageComponentCollector({ time: 90_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'kt_join') {
                game.players.add(i.user.id);
                if (game.defuserId === i.user.id) game.defuserId = null;
                await i.reply({ content: '✅ Joined as Expert! You\'ll receive the manual via DM when the game starts.', ephemeral: true });
            }
            if (i.customId === 'kt_defuse') {
                game.players.add(i.user.id);
                game.defuserId = i.user.id;
                await i.reply({ content: '💣 You are the Defuser! You\'ll see the bomb modules. Experts will guide you.', ephemeral: true });
            }
            if (i.customId === 'kt_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only host can start.', ephemeral: true });
                if (game.players.size < 2) return i.reply({ content: '❌ Need at least 2 players!', ephemeral: true });
                if (!game.defuserId) return i.reply({ content: '❌ Nobody has volunteered to defuse! Press "I\'ll Defuse".', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async (_, reason) => {
            if (game.players.size < 2 || !game.defuserId) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Game cancelled.')], components: [] });
            }
            await startBomb(interaction, msg, game);
        });
    }
};

async function startBomb(interaction, msg, game) {
    game.phase = 'active';
    game.startTime = Date.now();

    // DM experts the manual
    const experts = [...game.players].filter(id => id !== game.defuserId);
    const manualText = game.modules.map((m, i) =>
        `**Module ${i + 1} [${m.type.toUpperCase()}]:**\n${m.manual}`
    ).join('\n\n');

    for (const expertId of experts) {
        try {
            const u = await interaction.client.users.fetch(expertId);
            const dmEmbed = new EmbedBuilder()
                .setColor(0x1e3a5f)
                .setTitle('📘 BOMB MANUAL — Experts Only')
                .setDescription(`You are an **Expert**. The Defuser cannot see this.\n\n${manualText}`)
                .setFooter({ text: 'Guide the Defuser step by step through the channel.' });
            await u.send({ embeds: [dmEmbed] });
        } catch (e) { /* DMs closed */ }
    }

    await solveModule(interaction, msg, game);
}

async function solveModule(interaction, msg, game) {
    if (game.solved.every(Boolean)) return defused(interaction, msg, game);

    const idx = game.modules.findIndex((_, i) => !game.solved[i]);
    const mod = game.modules[idx];
    const elapsed = Math.floor((Date.now() - game.startTime) / 1000);
    const timeLeft = Math.max(0, game.timeLimit - elapsed);

    if (timeLeft <= 0) return explode(interaction, msg, game, 'Time ran out!');

    // Build defuser view
    const moduleDisplay = mod.type === 'wires'
        ? `**Wires:**\n${mod.wires.map((w, i) => `Wire ${i + 1}: ${w}`).join('\n')}`
        : mod.display || `Module type: ${mod.type}`;

    const progress = game.modules.map((m, i) => game.solved[i] ? '✅' : i === idx ? '💣' : '⬜').join(' ');

    const bombEmbed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle(`💣 MODULE ${idx + 1}/${game.modules.length} — ${mod.type.toUpperCase()}`)
        .setDescription(
            `⏱️ **${timeLeft}s remaining** | 💢 Strikes: ${game.strikes}/${game.maxStrikes}\n` +
            `Progress: ${progress}\n\n` +
            `**[DEFUSER VIEW — <@${game.defuserId}>]**\n${moduleDisplay}\n\n` +
            `*Experts: check your DM for the manual. Guide the defuser!*\n\n` +
            `**Defuser: type your answer in this channel!**`
        )
        .setFooter({ text: 'Experts have the manual via DM. Communicate!' });

    await msg.edit({ embeds: [bombEmbed], components: [] });

    // Collect defuser's typed answer
    const collector = interaction.channel.createMessageCollector({
        filter: m => m.author.id === game.defuserId && game.phase === 'active',
        time: timeLeft * 1000
    });

    let solved = false;

    collector.on('collect', async m => {
        await m.delete().catch(() => {});
        const answer = m.content.trim().toLowerCase();
        const correct = mod.answer.toLowerCase();

        if (answer === correct || answer.includes(correct.substring(0, 8).toLowerCase()) || correct.includes(answer.substring(0, 8))) {
            solved = true;
            game.solved[idx] = true;
            collector.stop('correct');
        } else {
            game.strikes++;
            if (game.strikes >= game.maxStrikes) {
                collector.stop('exploded');
            } else {
                const strikeMsg = await interaction.channel.send({ content: `❌ **Wrong!** Strike ${game.strikes}/${game.maxStrikes}. Try again!` });
                setTimeout(() => strikeMsg.delete().catch(() => {}), 4000);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'correct' || solved) {
            const okMsg = await interaction.channel.send({ content: `✅ **Module ${idx + 1} defused!**` });
            setTimeout(() => okMsg.delete().catch(() => {}), 3000);
            await new Promise(r => setTimeout(r, 1500));
            await solveModule(interaction, msg, game);
        } else if (reason === 'exploded' || game.strikes >= game.maxStrikes) {
            await explode(interaction, msg, game, `3 strikes — bomb detonated!`);
        } else {
            await explode(interaction, msg, game, 'Time ran out!');
        }
    });
}

async function defused(interaction, msg, game) {
    activeGames.delete(interaction.guildId);
    const elapsed = Math.floor((Date.now() - game.startTime) / 1000);

    const finalEmbed = new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle('✅ BOMB DEFUSED! YOU WIN!')
        .setDescription(
            `🎉 Outstanding teamwork! All modules defused with **${game.timeLimit - elapsed}s** to spare.\n\n` +
            `💣 **Defuser:** <@${game.defuserId}>\n` +
            `📘 **Experts:** ${[...game.players].filter(id => id !== game.defuserId).map(id => `<@${id}>`).join(', ')}\n\n` +
            `Strikes taken: **${game.strikes}/${game.maxStrikes}**\n` +
            `Time used: **${elapsed}s / ${game.timeLimit}s**`
        )
        .setFooter({ text: 'Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

async function explode(interaction, msg, game, reason) {
    activeGames.delete(interaction.guildId);

    const finalEmbed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle('💥 BOOM! THE BOMB EXPLODED!')
        .setDescription(
            `**${reason}**\n\n` +
            `💣 **Defuser:** <@${game.defuserId}>\n` +
            `📘 **Experts:** ${[...game.players].filter(id => id !== game.defuserId).map(id => `<@${id}>`).join(', ')}\n\n` +
            `Modules defused: **${game.solved.filter(Boolean).length}/${game.modules.length}**\n` +
            `Strikes: **${game.strikes}/${game.maxStrikes}**\n\n` +
            `**Manual (post-mortem):**\n${game.modules.map((m, i) => `Module ${i + 1}: ${m.answer}`).join('\n')}`
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

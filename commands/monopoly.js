// commands/monopoly.js — OM Monopoly (Property Management / Economy-Backed)
// F1-themed Monopoly. Players take turns rolling dice, buying circuits,
// paying rent, and trying to bankrupt each other. Uses the Economy model for coins.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const Economy = require('../models/Economy');

// ── Board ─────────────────────────────────────────────────────────────────────
const BOARD = [
    { id: 0,  name: 'START',           type: 'go',      price: 0,   rent: 0,   color: null      },
    { id: 1,  name: 'Monaco',          type: 'circuit', price: 60,  rent: 10,  color: '🔴'      },
    { id: 2,  name: 'Community Chest', type: 'chest',   price: 0,   rent: 0,   color: null      },
    { id: 3,  name: 'Silverstone',     type: 'circuit', price: 60,  rent: 10,  color: '🔴'      },
    { id: 4,  name: 'Tax',             type: 'tax',     price: 0,   rent: 50,  color: null      },
    { id: 5,  name: 'Pit Lane Entry',  type: 'transport',price:100, rent: 25,  color: '⚫'      },
    { id: 6,  name: 'Monza',           type: 'circuit', price: 100, rent: 18,  color: '🟤'      },
    { id: 7,  name: 'Chance',          type: 'chance',  price: 0,   rent: 0,   color: null      },
    { id: 8,  name: 'Spa',             type: 'circuit', price: 100, rent: 18,  color: '🟤'      },
    { id: 9,  name: 'Suzuka',          type: 'circuit', price: 120, rent: 20,  color: '🟤'      },
    { id: 10, name: 'Parc Fermé',      type: 'jail',    price: 0,   rent: 0,   color: null      },
    { id: 11, name: 'Melbourne',       type: 'circuit', price: 140, rent: 22,  color: '🩷'      },
    { id: 12, name: 'DRS Zone',        type: 'utility', price: 150, rent: 0,   color: '⚪'      },
    { id: 13, name: 'Bahrain',         type: 'circuit', price: 140, rent: 22,  color: '🩷'      },
    { id: 14, name: 'Imola',           type: 'circuit', price: 160, rent: 24,  color: '🩷'      },
    { id: 15, name: 'Safety Car Lane', type: 'transport',price:100, rent: 25,  color: '⚫'      },
    { id: 16, name: 'Baku',            type: 'circuit', price: 180, rent: 26,  color: '🟠'      },
    { id: 17, name: 'Community Chest', type: 'chest',   price: 0,   rent: 0,   color: null      },
    { id: 18, name: 'Singapore',       type: 'circuit', price: 180, rent: 26,  color: '🟠'      },
    { id: 19, name: 'Jeddah',          type: 'circuit', price: 200, rent: 28,  color: '🟠'      },
    { id: 20, name: 'Free Practice',   type: 'free',    price: 0,   rent: 0,   color: null      },
    { id: 21, name: 'Zandvoort',       type: 'circuit', price: 220, rent: 30,  color: '🔴'      },
    { id: 22, name: 'Chance',          type: 'chance',  price: 0,   rent: 0,   color: null      },
    { id: 23, name: 'Lusail',          type: 'circuit', price: 220, rent: 30,  color: '🔴'      },
    { id: 24, name: 'COTA',            type: 'circuit', price: 240, rent: 32,  color: '🔴'      },
    { id: 25, name: 'Pit Stop Bay',    type: 'transport',price:100, rent: 25,  color: '⚫'      },
    { id: 26, name: 'Interlagos',      type: 'circuit', price: 260, rent: 34,  color: '🟡'      },
    { id: 27, name: 'Hungaroring',     type: 'circuit', price: 260, rent: 34,  color: '🟡'      },
    { id: 28, name: 'Pit Lane Speed',  type: 'utility', price: 150, rent: 0,   color: '⚪'      },
    { id: 29, name: 'Abu Dhabi',       type: 'circuit', price: 280, rent: 36,  color: '🟡'      },
    { id: 30, name: 'Go to Parc Fermé',type:'gotojail', price: 0,   rent: 0,   color: null      },
    { id: 31, name: 'Barcelona',       type: 'circuit', price: 300, rent: 38,  color: '🟢'      },
    { id: 32, name: 'Mugello',         type: 'circuit', price: 300, rent: 38,  color: '🟢'      },
    { id: 33, name: 'Community Chest', type: 'chest',   price: 0,   rent: 0,   color: null      },
    { id: 34, name: 'Portimão',        type: 'circuit', price: 320, rent: 40,  color: '🟢'      },
    { id: 35, name: 'Paddock Club',    type: 'transport',price:100, rent: 25,  color: '⚫'      },
    { id: 36, name: 'Chance',          type: 'chance',  price: 0,   rent: 0,   color: null      },
    { id: 37, name: 'Las Vegas',       type: 'circuit', price: 350, rent: 50,  color: '🔵'      },
    { id: 38, name: 'Penalty Tax',     type: 'tax',     price: 0,   rent: 75,  color: null      },
    { id: 39, name: 'Yas Marina',      type: 'circuit', price: 400, rent: 60,  color: '🔵'      },
];

const CHANCE_CARDS = [
    { text: '⚡ Fastest lap bonus! Collect 50 coins.', effect: (p) => { p.coins += 50; } },
    { text: '🏆 Podium finish! Collect 100 coins.', effect: (p) => { p.coins += 100; } },
    { text: '🔴 Red flag! Miss your next turn.', effect: (p) => { p.skipTurn = true; } },
    { text: '🔧 Engine failure! Pay 80 coins.', effect: (p) => { p.coins -= 80; } },
    { text: '🚨 Drive-through penalty! Pay 60 coins.', effect: (p) => { p.coins -= 60; } },
    { text: '📻 Radio interference. Move forward 3 spaces.', effect: (p, game) => { p.position = (p.position + 3) % BOARD.length; } },
    { text: '🏎️ Upgrade package installed! Collect 75 coins.', effect: (p) => { p.coins += 75; } },
    { text: '🟡 Safety Car deployed. Advance to nearest transport.', effect: (p, game) => { const transports = [5,15,25,35]; const next = transports.find(t => t > p.position) || transports[0]; p.position = next; } },
];

const CHEST_CARDS = [
    { text: '💰 Sponsorship deal! Collect 90 coins.', effect: (p) => { p.coins += 90; } },
    { text: '🏁 Race victory bonus! Collect 150 coins.', effect: (p) => { p.coins += 150; } },
    { text: '⚠️ Tyre blowout. Pay 70 coins for repairs.', effect: (p) => { p.coins -= 70; } },
    { text: '📦 New parts arrived. Collect 50 coins.', effect: (p) => { p.coins += 50; } },
    { text: '🔩 Gearbox failure. Pay 100 coins.', effect: (p) => { p.coins -= 100; } },
    { text: '🎯 Pole position bonus! Collect 60 coins.', effect: (p) => { p.coins += 60; } },
];

const activeGames = new Map();
const STARTING_COINS = 1500;
const PASS_GO_BONUS  = 200;
const MAX_ROUNDS     = 40;   // auto-end after this many turns
const TURN_TIMEOUT   = 60_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('monopoly')
        .setDescription('🏁 OM Monopoly — Buy circuits, collect rent, bankrupt your rivals! (2-6 players)')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Start a new Monopoly game')
                .addBooleanOption(opt =>
                    opt.setName('use_economy')
                        .setDescription('Use server coin balance as starting funds? (default: false)')
                )
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('Force end the current game (Moderator)')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'end') {
            if (!interaction.member.permissions.has('ManageMessages') && !require('../lib/perms').isOwner(interaction.user.id)) {
                return interaction.reply({ content: '❌ No permission.', ephemeral: true });
            }
            if (!activeGames.has(interaction.guildId)) return interaction.reply({ content: '❌ No active game found.', ephemeral: true });
            activeGames.delete(interaction.guildId);
            return interaction.reply({ content: '🛑 Monopoly game ended.' });
        }

        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Monopoly game on this server!', ephemeral: true });
        }

        const useEconomy = interaction.options.getBoolean('use_economy') || false;

        const game = {
            hostId: interaction.user.id,
            phase: 'lobby',
            players: [],       // { userId, name, position, coins, properties: [], jailTurns, skipTurn, bankrupt }
            properties: new Map(), // squareId -> userId (owner)
            turn: 0,
            roundCount: 0,
            useEconomy,
            channelId: interaction.channelId,
            msg: null
        };
        activeGames.set(interaction.guildId, game);

        // Add host
        game.players.push(createPlayer(interaction.user.id, interaction.member?.displayName || interaction.user.username, STARTING_COINS));

        const playerEmojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

        const lobbyEmbed = () => new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('🏁 OM MONOPOLY')
            .setDescription(
                `**${interaction.user.displayName}** is hosting!\n\n` +
                `Players:\n${game.players.map((p, i) => `${playerEmojis[i]} ${p.name}`).join('\n')}\n\n` +
                `Starting coins: **${STARTING_COINS.toLocaleString()} 🪙**\n` +
                `Pass GO: **+${PASS_GO_BONUS} 🪙**\n` +
                `Max rounds: **${MAX_ROUNDS}**`
            )
            .setFooter({ text: '2-6 players — Press Join, then host presses Start' });

        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mp_join').setLabel('🎮 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('mp_start').setLabel('▶️ Start').setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [lobbyEmbed()], components: [lobbyRow], fetchReply: true });
        game.msg = msg;

        const lobbyCollector = msg.createMessageComponentCollector({ time: 90_000 });

        lobbyCollector.on('collect', async i => {
            if (i.customId === 'mp_join') {
                if (game.players.find(p => p.userId === i.user.id)) return i.reply({ content: '✅ Already joined!', ephemeral: true });
                if (game.players.length >= 6) return i.reply({ content: '❌ Game full (max 6 players).', ephemeral: true });
                game.players.push(createPlayer(i.user.id, i.member?.displayName || i.user.username, STARTING_COINS));
                await i.update({ embeds: [lobbyEmbed()] });
            }
            if (i.customId === 'mp_start') {
                if (!require('../lib/perms').canControlGame(i, game.hostId)) return i.reply({ content: '❌ Only the host can start.', ephemeral: true });
                if (game.players.length < 2) return i.reply({ content: '❌ At least 2 players required!', ephemeral: true });
                lobbyCollector.stop('start');
                await i.deferUpdate();
            }
        });

        lobbyCollector.on('end', async (_, reason) => {
            if (game.players.length < 2) {
                activeGames.delete(interaction.guildId);
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0x555555).setTitle('❌ Game cancelled — not enough players.')], components: [] });
            }
            game.phase = 'playing';
            await takeTurn(interaction, msg, game, playerEmojis);
        });
    }
};

function createPlayer(userId, name, coins) {
    return { userId, name, position: 0, coins, properties: [], jailTurns: 0, skipTurn: false, bankrupt: false };
}

function rollDice() {
    return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

function buildBoardView(game, playerEmojis) {
    return game.players
        .filter(p => !p.bankrupt)
        .map((p, i) => {
            const square = BOARD[p.position];
            const owned = game.properties.get(p.position);
            return `${playerEmojis[i]} **${p.name}** — ${square.color || '⬜'} ${square.name} | 🪙 ${p.coins.toLocaleString()}`;
        }).join('\n');
}

async function takeTurn(interaction, msg, game, playerEmojis) {
    const activePlayers = game.players.filter(p => !p.bankrupt);
    if (activePlayers.length <= 1) return endGame(interaction, msg, game, playerEmojis);

    const currentIdx = game.turn % activePlayers.length;
    const player = activePlayers[currentIdx];
    game.roundCount++;

    if (game.roundCount > MAX_ROUNDS * game.players.length) {
        return endGame(interaction, msg, game, playerEmojis);
    }

    // Skip turn?
    if (player.skipTurn) {
        player.skipTurn = false;
        game.turn++;
        return takeTurn(interaction, msg, game, playerEmojis);
    }

    // Jail logic
    if (player.jailTurns > 0) {
        player.jailTurns--;
        const jailEmbed = new EmbedBuilder()
            .setColor(0x555555)
            .setTitle(`🚔 ${player.name} is in Parc Fermé!`)
            .setDescription(`${player.name} is stuck in Parc Fermé for ${player.jailTurns} more turn(s).\n\n${buildBoardView(game, playerEmojis)}`)
            .setFooter({ text: `Turn ${game.roundCount} | Round ${Math.ceil(game.roundCount / activePlayers.length)}/${MAX_ROUNDS}` });
        await msg.edit({ embeds: [jailEmbed], components: [] });
        await new Promise(r => setTimeout(r, 2500));
        game.turn++;
        return takeTurn(interaction, msg, game, playerEmojis);
    }

    const turnEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle(`🎲 ${player.name}'s Turn`)
        .setDescription(`${playerEmojis[currentIdx]} **${player.name}** — press **Roll** to roll the dice!\n\n${buildBoardView(game, playerEmojis)}`)
        .addFields({ name: '🪙 Your Balance', value: `${player.coins.toLocaleString()} coins`, inline: true })
        .setFooter({ text: `Turn ${game.roundCount} | Round ${Math.ceil(game.roundCount / activePlayers.length)}/${MAX_ROUNDS}` });

    const rollRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('mp_roll').setLabel('🎲 Roll Dice').setStyle(ButtonStyle.Primary)
    );

    await msg.edit({ embeds: [turnEmbed], components: [rollRow] });

    const collector = msg.createMessageComponentCollector({
        filter: i => i.customId === 'mp_roll' && i.user.id === player.userId,
        time: TURN_TIMEOUT,
        max: 1
    });

    collector.on('collect', async i => {
        await i.deferUpdate();
        const roll = rollDice();
        const oldPos = player.position;
        player.position = (player.position + roll) % BOARD.length;

        // Passed GO?
        if (player.position < oldPos || (oldPos + roll >= BOARD.length)) {
            player.coins += PASS_GO_BONUS;
        }

        const square = BOARD[player.position];
        let eventText = `Rolled **${roll}** — landed on ${square.color || '⬜'} **${square.name}**\n\n`;
        let actionRow = null;

        if (square.type === 'gotojail') {
            player.position = 10;
            player.jailTurns = 3;
            eventText += `🚔 **Sent to Parc Fermé!** Stuck for 3 turns.`;
        } else if (square.type === 'tax') {
            player.coins -= square.rent;
            if (player.coins < 0) player.coins = 0;
            eventText += `💸 **Tax! Paid ${square.rent} coins.**`;
        } else if (square.type === 'chance') {
            const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
            card.effect(player, game);
            eventText += `🃏 **Chance:** ${card.text}`;
        } else if (square.type === 'chest') {
            const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
            card.effect(player, game);
            eventText += `📦 **Community Chest:** ${card.text}`;
        } else if (square.type === 'circuit' || square.type === 'transport' || square.type === 'utility') {
            const owner = game.properties.get(square.id);
            if (!owner) {
                if (player.coins >= square.price) {
                    actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('mp_buy').setLabel(`🏁 Buy ${square.name} (${square.price} 🪙)`).setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('mp_skip_buy').setLabel('Pass').setStyle(ButtonStyle.Secondary)
                    );
                    eventText += `🏁 **${square.name}** is for sale! Price: **${square.price} 🪙**`;
                } else {
                    eventText += `🏁 **${square.name}** is for sale but you can't afford it (${square.price} 🪙).`;
                }
            } else if (owner === player.userId) {
                eventText += `✅ You own **${square.name}**.`;
            } else {
                const ownerPlayer = game.players.find(p => p.userId === owner);
                let rent = square.rent;
                if (square.type === 'utility') rent = roll * 10;
                if (square.type === 'transport') {
                    const transportCount = game.players.filter(p => p.userId === owner)[0]?.properties.filter(id => BOARD[id].type === 'transport').length || 1;
                    rent = 25 * transportCount;
                }
                player.coins -= rent;
                if (ownerPlayer) ownerPlayer.coins += rent;
                if (player.coins <= 0) {
                    player.coins = 0;
                    player.bankrupt = true;
                    eventText += `💀 **Bankrupt!** ${player.name} paid **${rent} 🪙** rent to ${ownerPlayer?.name || 'the bank'} and ran out of coins!`;
                } else {
                    eventText += `💸 **Rent paid!** ${player.name} paid **${rent} 🪙** to ${ownerPlayer?.name || 'the bank'}.`;
                }
            }
        } else if (square.type === 'go') {
            eventText += `🟢 **Back to START!** Collected ${PASS_GO_BONUS} 🪙.`;
            player.coins += PASS_GO_BONUS;
        } else {
            eventText += `Nothing happens here. Free turn!`;
        }

        if (player.coins < 0) player.coins = 0;

        const eventEmbed = new EmbedBuilder()
            .setColor(player.bankrupt ? 0x555555 : 0x00c851)
            .setTitle(`🎲 ${player.name} rolled a ${roll}!`)
            .setDescription(`${eventText}\n\n${buildBoardView(game, playerEmojis)}`)
            .addFields({ name: '🪙 Balance', value: `${player.coins.toLocaleString()} coins`, inline: true })
            .setFooter({ text: `Turn ${game.roundCount}` });

        if (actionRow) {
            await msg.edit({ embeds: [eventEmbed], components: [actionRow] });

            const buyCollector = msg.createMessageComponentCollector({
                filter: bi => ['mp_buy', 'mp_skip_buy'].includes(bi.customId) && bi.user.id === player.userId,
                time: 30_000,
                max: 1
            });

            buyCollector.on('collect', async bi => {
                await bi.deferUpdate();
                if (bi.customId === 'mp_buy') {
                    player.coins -= square.price;
                    player.properties.push(square.id);
                    game.properties.set(square.id, player.userId);
                    const buyEmbed = EmbedBuilder.from(eventEmbed)
                        .setDescription(`✅ **${player.name}** bought **${square.name}** for **${square.price} 🪙**!\n\n${buildBoardView(game, playerEmojis)}`);
                    await msg.edit({ embeds: [buyEmbed], components: [] });
                } else {
                    await msg.edit({ embeds: [eventEmbed], components: [] });
                }
            });

            buyCollector.on('end', async () => {
                game.turn++;
                await new Promise(r => setTimeout(r, 2000));
                await takeTurn(interaction, msg, game, playerEmojis);
            });
            return;
        }

        await msg.edit({ embeds: [eventEmbed], components: [] });
        game.turn++;
        await new Promise(r => setTimeout(r, 3000));
        await takeTurn(interaction, msg, game, playerEmojis);
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await interaction.channel.send({ content: `⏰ **${player.name}** took too long! Turn skipped.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            game.turn++;
            await takeTurn(interaction, msg, game, playerEmojis);
        }
    });
}

async function endGame(interaction, msg, game, playerEmojis) {
    activeGames.delete(interaction.guildId);

    const alive = game.players.filter(p => !p.bankrupt).sort((a, b) => (b.coins + b.properties.length * 50) - (a.coins + a.properties.length * 50));
    const all = [...alive, ...game.players.filter(p => p.bankrupt)];

    const finalEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('🏆 OM MONOPOLY — GAME OVER!')
        .setDescription(
            `🎉 **Winner: ${alive[0]?.name || 'Nobody'}** — ${alive[0]?.coins || 0} coins + ${alive[0]?.properties.length || 0} properties\n\n` +
            all.map((p, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
                const status = p.bankrupt ? '💀 Bankrupt' : `🪙 ${p.coins.toLocaleString()}`;
                return `${medal} **${p.name}** — ${status} | 🏁 ${p.properties.length} circuits`;
            }).join('\n')
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Game Night' });

    await msg.edit({ embeds: [finalEmbed], components: [] });
}

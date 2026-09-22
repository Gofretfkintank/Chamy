// commands/hangman.js — Hangman (Category-Based / F1 & OM Themed)
// Classic hangman game. Categories: Drivers, Teams, Circuits, F1 General, OM Special.
// Multiplayer — anyone can guess a letter.

const {
    SlashCommandBuilder,
    EmbedBuilder,
} = require('discord.js');

const CATEGORIES = {
    driver: {
        label: '🏎️ Driver',
        words: [
            'VERSTAPPEN', 'HAMILTON', 'LECLERC', 'NORRIS', 'SAINZ',
            'ALONSO', 'RUSSELL', 'PEREZ', 'STROLL', 'OCON',
            'GASLY', 'TSUNODA', 'BOTTAS', 'HULKENBERG', 'ALBON',
            'ZHOU', 'MAGNUSSEN', 'PIASTRI', 'LAWSON', 'BEARMAN'
        ]
    },
    team: {
        label: '🏭 Team',
        words: [
            'FERRARI', 'REDBULL', 'MERCEDES', 'MCLAREN', 'ALPINE',
            'ASTONMARTIN', 'WILLIAMS', 'HAAS', 'SAUBER', 'RACINGBULLS'
        ]
    },
    circuit: {
        label: '🗺️ Circuit',
        words: [
            'MONACO', 'SILVERSTONE', 'MONZA', 'SUZUKA', 'SEPANG',
            'INTERLAGOS', 'BAHRAIN', 'MELBOURNE', 'BARCELONA', 'HUNGARORING',
            'ZANDVOORT', 'COTA', 'IMOLA', 'JEDDAH', 'LUSAIL',
            'BAKU', 'NURBURGRING', 'MUGELLO', 'PORTIMAO', 'SINGAPORE'
        ]
    },
    general: {
        label: '🏁 F1 General',
        words: [
            'PITWALL', 'UNDERCUT', 'OVERCUT', 'BOXBOX', 'SAFETYCAR',
            'DRAGZONE', 'CHECKERED', 'PITSTOP', 'DOWNFORCE', 'AEROBODY',
            'KERBSTONE', 'GRAINING', 'BLISTER', 'FLATSPOT', 'JUMPSTART',
            'MARSHAL', 'STEWARD', 'PARCFERME', 'FASTESTLAP', 'VIRTUAL'
        ]
    },
    om: {
        label: '🔴 OM Special',
        words: [
            'OLZHASSTIK', 'MOTORSPORTS', 'GAMENIGHT', 'PITLANE',
            'COMMANDER', 'POLEPOSITION', 'RACETIME', 'OMBOT',
            'OMLEAGUE', 'OMSEASON'
        ]
    }
};

const HANGMAN_STAGES = [
    '```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```'
];

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hangman')
        .setDescription('🪓 Hangman — Guess the word before time runs out!')
        .addStringOption(opt =>
            opt.setName('category')
                .setDescription('Word category')
                .addChoices(
                    { name: '🏎️ Driver', value: 'driver' },
                    { name: '🏭 Team', value: 'team' },
                    { name: '🗺️ Circuit', value: 'circuit' },
                    { name: '🏁 F1 General', value: 'general' },
                    { name: '🔴 OM Special', value: 'om' },
                    { name: '🎲 Random', value: 'random' }
                )
        ),

    async execute(interaction) {
        if (activeGames.has(interaction.guildId)) {
            return interaction.reply({ content: '⚠️ There is already an active Hangman game on this server!', ephemeral: true });
        }

        let catKey = interaction.options.getString('category') || 'random';
        if (catKey === 'random') {
            const keys = Object.keys(CATEGORIES);
            catKey = keys[Math.floor(Math.random() * keys.length)];
        }

        const cat = CATEGORIES[catKey];
        const word = cat.words[Math.floor(Math.random() * cat.words.length)];

        const game = {
            word,
            category: cat.label,
            guessed: new Set(),
            wrong: new Set(),
            lives: 6,
            phase: 'playing',
            guessers: new Map()
        };
        activeGames.set(interaction.guildId, game);

        const buildEmbed = (phase = 'playing') => {
            const display = word.split('').map(c => game.guessed.has(c) ? `**${c}**` : '\\_').join(' ');
            const wrongList = [...game.wrong].join(', ') || '—';
            const stage = HANGMAN_STAGES[6 - game.lives];
            const colorMap = { playing: 0xf5c518, win: 0x00c851, lose: 0x8b0000 };
            return new EmbedBuilder()
                .setColor(colorMap[phase])
                .setTitle(`🪓 HANGMAN — ${game.category}`)
                .setDescription(
                    `${stage}\n` +
                    `**Word:** ${display}\n\n` +
                    `❌ Wrong letters: ${wrongList}\n` +
                    `❤️ Lives remaining: ${game.lives}/6`
                )
                .setFooter({ text: 'Type a single letter in this channel to guess!' });
        };

        const msg = await interaction.reply({ embeds: [buildEmbed()], fetchReply: true });

        const collector = interaction.channel.createMessageCollector({
            filter: m => !m.author.bot && game.phase === 'playing',
            time: 180_000
        });

        collector.on('collect', async m => {
            const letter = m.content.trim().toUpperCase();
            if (!/^[A-Z]$/.test(letter)) return;

            await m.delete().catch(() => {});

            if (game.guessed.has(letter) || game.wrong.has(letter)) {
                const warn = await interaction.channel.send({ content: `⚠️ **${letter}** has already been guessed!` });
                setTimeout(() => warn.delete().catch(() => {}), 2500);
                return;
            }

            if (word.includes(letter)) {
                game.guessed.add(letter);
                const score = word.split('').filter(c => c === letter).length;
                game.guessers.set(m.author.id, (game.guessers.get(m.author.id) || 0) + score);
            } else {
                game.wrong.add(letter);
                game.lives--;
            }

            const won = word.split('').every(c => game.guessed.has(c));
            const lost = game.lives <= 0;

            if (won || lost) {
                game.phase = 'done';
                collector.stop(won ? 'win' : 'lose');
            }

            await msg.edit({ embeds: [buildEmbed(won ? 'win' : lost ? 'lose' : 'playing')] });
        });

        collector.on('end', async (_, reason) => {
            activeGames.delete(interaction.guildId);
            const display = word.split('').map(c => `**${c}**`).join(' ');

            const topGuessers = [...game.guessers.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([id, pts], i) => `${['🥇', '🥈', '🥉'][i]} <@${id}> — ${pts} letter${pts > 1 ? 's' : ''}`);

            const finalEmbed = new EmbedBuilder()
                .setColor(reason === 'win' ? 0x00c851 : 0x8b0000)
                .setTitle(reason === 'win' ? '🎉 Word Found!' : reason === 'time' ? '⏰ Time\'s Up!' : '💀 Game Over!')
                .setDescription(
                    `**Word:** ${display}\n` +
                    `**Category:** ${game.category}\n\n` +
                    (topGuessers.length ? `**Top Contributors:**\n${topGuessers.join('\n')}` : '')
                )
                .setFooter({ text: 'Game Night' });

            await msg.edit({ embeds: [finalEmbed] });
        });
    }
};

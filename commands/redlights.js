// commands/redlights.js — 5 Red Lights (Reaction Speed / F1 Start System)
// Classic F1 start simulation. 5 lights illuminate one by one, then go out.
// The fastest player to press the button wins. Early presses count as a jump start.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const activeRaces = new Map(); // channelId -> race state

module.exports = {
    data: new SlashCommandBuilder()
        .setName('redlights')
        .setDescription('🔴 5 Red Lights — F1 Start Reaction Race!')
        .addIntegerOption(opt =>
            opt.setName('lights_time')
                .setDescription('Time for lights to illuminate (seconds, default: 5)')
                .setMinValue(3)
                .setMaxValue(10)
        ),

    async execute(interaction) {
        if (activeRaces.has(interaction.channelId)) {
            return interaction.reply({ content: '⚠️ There is already an active race in this channel!', ephemeral: true });
        }

        const lightsOnTime = (interaction.options.getInteger('lights_time') || 5) * 1000;

        const race = {
            active: false,
            startTime: null,
            results: [],
            finished: new Set(),
        };
        activeRaces.set(interaction.channelId, race);

        const buildLightEmbed = (lit, phase = 'lights') => {
            const lights = Array.from({ length: 5 }, (_, i) => i < lit ? '🔴' : '⬛').join('  ');
            const titles = { lights: '🏁 F1 Start Sequence', go: '🟢 GO GO GO!', done: '🏆 Results' };
            return new EmbedBuilder()
                .setColor(phase === 'go' ? 0x00c851 : phase === 'done' ? 0xf5c518 : 0xcc0000)
                .setTitle(titles[phase])
                .setDescription(
                    phase === 'lights'
                        ? `${lights}\n\n⚠️ **Hit the button when the lights go OUT!**\nPressing early counts as a jump start.`
                        : phase === 'go'
                        ? `${lights}\n\n**⚡ PRESS NOW!**`
                        : lights
                )
                .setFooter({ text: 'Race Night' });
        };

        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rl_go').setLabel('🔴 Waiting...').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        const activeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rl_go').setLabel('🟢 START!').setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.reply({ embeds: [buildLightEmbed(0)], components: [disabledRow], fetchReply: true });

        const lightDelay = lightsOnTime / 5;
        for (let i = 1; i <= 5; i++) {
            await new Promise(r => setTimeout(r, lightDelay));
            await msg.edit({ embeds: [buildLightEmbed(i)], components: [disabledRow] });
        }

        // Random extra wait before lights out (0.5s – 2.5s)
        const extraWait = Math.random() * 2000 + 500;
        await new Promise(r => setTimeout(r, extraWait));

        race.active = true;
        race.startTime = Date.now();

        await msg.edit({ embeds: [buildLightEmbed(0, 'go')], components: [activeRow] });

        const collector = msg.createMessageComponentCollector({ filter: i => i.customId === 'rl_go', time: 10_000 });

        collector.on('collect', async i => {
            if (race.finished.has(i.user.id)) return i.reply({ content: '✅ Already registered!', ephemeral: true });
            race.finished.add(i.user.id);
            const elapsed = Date.now() - race.startTime;
            race.results.push({ userId: i.user.id, time: elapsed });

            const pos = race.results.length;
            const medal = ['🥇', '🥈', '🥉'][pos - 1] || `${pos}.`;
            await i.reply({ content: `${medal} **${elapsed}ms** — <@${i.user.id}>` });
        });

        collector.on('end', async () => {
            activeRaces.delete(interaction.channelId);

            if (race.results.length === 0) {
                return msg.edit({
                    embeds: [new EmbedBuilder().setColor(0x555555).setTitle('🏁 No one reacted — race cancelled.')],
                    components: []
                });
            }

            race.results.sort((a, b) => a.time - b.time);
            const maxTime = race.results[race.results.length - 1].time;

            const board = race.results.map((r, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
                const filled = Math.round((1 - r.time / (maxTime + 100)) * 10);
                const bar = `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
                return `${medal} <@${r.userId}> — **${r.time}ms** ${bar}`;
            }).join('\n');

            const resultEmbed = new EmbedBuilder()
                .setColor(0xf5c518)
                .setTitle('🏆 Race Over — Final Results')
                .setDescription(`🏎️ **Winner:** <@${race.results[0].userId}> — **${race.results[0].time}ms**\n\n${board}`)
                .setFooter({ text: 'Olzhasstik Motorsports — 5 Red Lights' });

            await msg.edit({ embeds: [resultEmbed], components: [] });
        });
    }
};

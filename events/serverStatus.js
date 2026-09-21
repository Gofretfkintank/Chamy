//--------------------------------
// SERVER STATUS EVENT
// Listens in the channel where DiscordSRV posts startup/shutdown
// messages, then sends a clean embed to the OM server-status channel.
//
// This is OM's own Minecraft server, so it stays tied to the home guild:
// both ids are read from THAT guild's config (the source channel lives in a
// separate test server, so message.guildId would be the wrong place to look).
//--------------------------------

const { EmbedBuilder } = require('discord.js');
const cfg = require('../lib/guildConfig');
const { LEGACY_GUILD_ID } = require('../lib/legacySeed');

//--------------------------------
// MAIN EXPORT
//--------------------------------
module.exports = (client) => {

    client.on('messageCreate', async (message) => {
        // Cheap checks first, so the config lookup stays off ordinary messages.
        if (!message.author.bot) return;
        if (message.author.id === client.user.id) return;

        const sourceId = await cfg.get(LEGACY_GUILD_ID, 'minecraft:statusSource');
        if (!sourceId || message.channel.id !== sourceId) return;

        const isStart = message.content.includes('Server has started');
        const isStop  = message.content.includes('Server has stopped');
        if (!isStart && !isStop) return;

        const targetId = await cfg.get(LEGACY_GUILD_ID, 'minecraft:statusChannel');
        if (!targetId) return;
        const targetChannel = await client.channels.fetch(targetId).catch(() => null);
        if (!targetChannel) return;

        const now = Math.floor(Date.now() / 1000);

        const embed = isStart
            ? new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🟢  Server Online')
                .setDescription('The Minecraft server is up and running.\n**You can now connect!**')
                .addFields(
                    { name: '📡 Status', value: '`Online`',  inline: true },
                    { name: '⏱️ Time',   value: `<t:${now}:R>`, inline: true }
                )
                .setFooter({ text: 'Olzhasstik Motorsports • Minecraft' })
                .setTimestamp()
            : new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🔴  Server Offline')
                .setDescription('The Minecraft server has shut down.')
                .addFields(
                    { name: '📡 Status', value: '`Offline`', inline: true },
                    { name: '⏱️ Time',   value: `<t:${now}:R>`, inline: true }
                )
                .setFooter({ text: 'Olzhasstik Motorsports • Minecraft' })
                .setTimestamp();

        await targetChannel.send({ embeds: [embed] }).catch(console.error);

        // Update channel name emoji based on server state
        try {
            await targetChannel.setName(isStart ? '🟢┃server-status' : '🔴┃server-status');
        } catch (err) {
            console.error('[ServerStatus] Channel rename failed:', err.message);
        }

        console.log(`[ServerStatus] ${isStart ? 'ONLINE' : 'OFFLINE'} embed sent to OM server.`);
    });
};

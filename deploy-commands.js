const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
require('dotenv').config();

// Commands used to be registered only to the guilds named in GUILD_ID_1..3,
// which meant the bot was invisible in every other server no matter what else
// worked. They are global now.
//
// Global registration can take up to an hour to propagate, which is painful
// while developing, so DEPLOY_SCOPE=guild still registers instantly to the dev
// guilds below. Never both at once: a command registered globally AND in a
// guild shows up twice in that guild's picker.

const commands         = [];
const homeOnlyCommands = [];
for (const file of fs.readdirSync('./commands').filter(f => f.endsWith('.js'))) {
    const command = require(`./commands/${file}`);
    if (!command?.data) {
        console.warn(`[SKIP] commands/${file} exports no "data" — not registering it.`);
        continue;
    }
    (command.homeOnly ? homeOnlyCommands : commands).push(command.data.toJSON());
}

const { LEGACY_GUILD_ID } = require('./lib/legacySeed');

const devGuilds = (process.env.DEV_GUILD_IDS || [
    process.env.GUILD_ID_1,
    process.env.GUILD_ID_2,
    process.env.GUILD_ID_3
].filter(Boolean).join(','))
    .split(',').map(s => s.trim()).filter(Boolean);

const scope = (process.env.DEPLOY_SCOPE || 'global').toLowerCase();
const rest  = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    if (!process.env.CLIENT_ID || !process.env.TOKEN) {
        console.error('[SYSTEM] CLIENT_ID and TOKEN must both be set.');
        process.exit(1);
    }

    try {
        console.log(`[SYSTEM] Registering ${commands.length} commands (scope: ${scope})...`);

        if (scope === 'guild') {
            if (!devGuilds.length) {
                console.error('[SYSTEM] DEPLOY_SCOPE=guild but no DEV_GUILD_IDS / GUILD_ID_* were given.');
                process.exit(1);
            }
            for (const guildId of devGuilds) {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: commands }
                );
                console.log(`✅ Registered in guild ${guildId} (instant, dev only)`);
            }
            console.log('[SYSTEM] Done. These are dev copies — run without DEPLOY_SCOPE to go global.');
            process.exit(0);
        }

        // Going global: clear any guild-scoped copies first, or every command
        // registered both ways appears twice in that guild.
        for (const guildId of devGuilds) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: [] }
                );
                console.log(`🧹 Cleared guild-scoped copies in ${guildId}`);
            } catch (err) {
                // Usually means the bot is no longer in that guild. Not fatal.
                console.warn(`⚠️  Could not clear ${guildId}: ${err.message}`);
            }
        }

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Registered globally — available in every server the bot joins.');

        if (homeOnlyCommands.length && LEGACY_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, LEGACY_GUILD_ID),
                { body: homeOnlyCommands }
            );
            console.log(`🏠 ${homeOnlyCommands.length} home-only command(s) registered to ${LEGACY_GUILD_ID} only.`);
        }

        console.log('[SYSTEM] Done. Global commands can take up to an hour to appear.');
        process.exit(0);

    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();

//--------------------------------
// BUMP REMINDER EVENT
// Listens in each server's configured bump channel for Carl and Disboard
// bump confirmations, then sends a reminder when the cooldown expires.
//
// Carl     → personal cooldown → mentions the bumper
// Disboard → server cooldown   → mentions that server's bumpers role
//
// This used to serve one server: one bump channel, one role, and a single
// Disboard timer keyed just 'disboard'. Every timer and record is now keyed by
// guild, so two servers bumping at once no longer overwrite each other.
//--------------------------------

const { EmbedBuilder } = require('discord.js');
const BumpReminder = require('../models/BumpReminder');
const cfg = require('../lib/guildConfig');
const { LEGACY_GUILD_ID, seedLegacyGuild } = require('../lib/legacySeed');

//--------------------------------
// CONFIG
//--------------------------------

// Cooldowns in milliseconds
const CARL_COOLDOWN_MS    = 6 * 60 * 60 * 1000; // 6 hours
const DISBOARD_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

// Carl's and Disboard's bot user ids — global, the same in every server.
const CARL_BOT_ID     = '235148962103951360';
const DISBOARD_BOT_ID = '302050872383242240';

//--------------------------------
// ACTIVE TIMER MAP
// Key: 'carl_<guildId>_<userId>' | 'disboard_<guildId>'
// Value: setTimeout handle
//--------------------------------
const timerMap = new Map();

// Reminders stored before guilds were tracked can only be the home guild's.
const guildOf = record => record.guildId || LEGACY_GUILD_ID;

// Matches this guild's records, plus the untagged legacy ones in the home guild.
const guildFilter = guildId =>
    guildId === LEGACY_GUILD_ID ? { $in: [guildId, null] } : guildId;

async function bumpChannelFor(client, guildId) {
    const id = await cfg.get(guildId, 'channels:bump');
    if (!id) return null;
    const channel = await client.channels.fetch(id).catch(() => null);
    // A channel id that points into another server must never be posted to.
    return channel && channel.guildId === guildId ? channel : null;
}

//--------------------------------
// FIRE HELPERS
//--------------------------------
async function fireCarlReminder(client, reminderId, guildId, userId) {
    timerMap.delete(`carl_${guildId}_${userId}`);

    const record = await BumpReminder.findById(reminderId).catch(() => null);
    if (!record || record.notified) return;

    record.notified = true;
    await record.save();

    const channel = await bumpChannelFor(client, guildId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor(0x00C853)
        .setTitle('🟢 Carl Bump Available!')
        .setDescription(
            `<@${userId}>, your Carl server discovery bump cooldown has expired!\n\n` +
            `Head over to [Carl's Server Discovery](https://carl.gg/server-discovery) and bump us again to keep us climbing the rankings! 📈`
        )
        .setFooter({ text: `${channel.guild.name} • Bump System` })
        .setTimestamp();

    await channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
}

async function fireDisboardReminder(client, reminderId, guildId) {
    timerMap.delete(`disboard_${guildId}`);

    const record = await BumpReminder.findById(reminderId).catch(() => null);
    if (!record || record.notified) return;

    record.notified = true;
    await record.save();

    const channel = await bumpChannelFor(client, guildId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📣 Disboard Bump Ready!')
        .setDescription(
            `The server bump cooldown on Disboard has ended!\n\n` +
            `Use \`/bump\` in this channel to push **${channel.guild.name}** up the Disboard rankings!\n` +
            `Every bump helps new members find us 🏁`
        )
        .setFooter({ text: `${channel.guild.name} • Bump System` })
        .setTimestamp();

    // No role configured is fine: the reminder still posts, it just pings nobody.
    const bumpersRole = await cfg.get(guildId, 'roles:bumpers');
    await channel.send({
        content: bumpersRole ? `<@&${bumpersRole}>` : undefined,
        embeds : [embed]
    }).catch(() => {});
}

//--------------------------------
// SCHEDULE HELPERS
//--------------------------------
function scheduleCarlReminder(client, record) {
    const guildId = guildOf(record);
    const key = `carl_${guildId}_${record.userId}`;
    const remaining = record.remindAt - Date.now();

    if (timerMap.has(key)) {
        clearTimeout(timerMap.get(key));
        timerMap.delete(key);
    }

    if (remaining <= 0) return;

    const handle = setTimeout(
        () => fireCarlReminder(client, record._id.toString(), guildId, record.userId),
        remaining
    );
    timerMap.set(key, handle);
}

function scheduleDisboardReminder(client, record) {
    const guildId = guildOf(record);
    const key = `disboard_${guildId}`;
    const remaining = record.remindAt - Date.now();

    if (timerMap.has(key)) {
        clearTimeout(timerMap.get(key));
        timerMap.delete(key);
    }

    if (remaining <= 0) return;

    const handle = setTimeout(
        () => fireDisboardReminder(client, record._id.toString(), guildId),
        remaining
    );
    timerMap.set(key, handle);
}

//--------------------------------
// DETECTION HELPERS
//--------------------------------
function isCarlBump(message) {
    // Carl confirms with a message containing this text
    return (
        message.author.id === CARL_BOT_ID &&
        message.content.includes('successfully bumped this server')
    );
}

function isDisboardBump(message) {
    // Disboard confirms via embed
    if (message.author.id !== DISBOARD_BOT_ID) return false;

    // Check embed description for bump confirmation
    const embeds = message.embeds;
    if (!embeds || embeds.length === 0) return false;

    return embeds.some(e =>
        (e.description && e.description.toLowerCase().includes('bump done')) ||
        (e.title && e.title.toLowerCase().includes('bump done'))
    );
}

//--------------------------------
// MAIN EXPORT
//--------------------------------
module.exports = (client) => {

    //--------------------------------
    // READY — restore pending reminders from DB
    //--------------------------------
    client.once('ready', async () => {
        // Overdue reminders fire right here and read the bump channel from
        // config; on the first boot after the migration that config is being
        // written in this same 'ready', so wait for it.
        await seedLegacyGuild();

        const pending = await BumpReminder.find({ notified: false }).catch(() => []);

        let restored = 0;
        for (const record of pending) {
            const guildId = guildOf(record);
            if (record.remindAt <= Date.now()) {
                // Already past — fire immediately then mark done
                if (record.type === 'carl' && record.userId) {
                    await fireCarlReminder(client, record._id.toString(), guildId, record.userId);
                } else if (record.type === 'disboard') {
                    await fireDisboardReminder(client, record._id.toString(), guildId);
                }
                continue;
            }

            if (record.type === 'carl' && record.userId) {
                scheduleCarlReminder(client, record);
            } else if (record.type === 'disboard') {
                scheduleDisboardReminder(client, record);
            }
            restored++;
        }

        console.log(`✅ ${restored} bump reminder(s) restored`);
    });

    //--------------------------------
    // MESSAGE CREATE — detect bump confirmations
    //--------------------------------
    client.on('messageCreate', async (message) => {
        if (!message.guild) return;

        // Only Carl and Disboard matter here. Checking the author first keeps
        // the config lookup off every other message in every server.
        if (message.author.id !== CARL_BOT_ID && message.author.id !== DISBOARD_BOT_ID) return;

        const guildId = message.guildId;
        const bumpChannelId = await cfg.get(guildId, 'channels:bump');
        if (!bumpChannelId || message.channel.id !== bumpChannelId) return;

        //------------------------------------------------
        // CARL BUMP DETECTED
        // Carl sends a plain message (not an embed) in the
        // channel when someone successfully bumps.
        // We look at message.reference to find who triggered it,
        // or fall back to the message before Carl's in the channel.
        //------------------------------------------------
        if (isCarlBump(message)) {
            // Try to find the bumper via the replied-to message
            let bumperId = null;

            if (message.reference?.messageId) {
                const ref = await message.channel.messages
                    .fetch(message.reference.messageId)
                    .catch(() => null);
                if (ref && !ref.author.bot) bumperId = ref.author.id;
            }

            // Fallback: fetch recent messages and find the last human message
            if (!bumperId) {
                const recent = await message.channel.messages
                    .fetch({ limit: 10, before: message.id })
                    .catch(() => null);

                if (recent) {
                    const lastHuman = recent
                        .filter(m => !m.author.bot)
                        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                        .first();

                    if (lastHuman) bumperId = lastHuman.author.id;
                }
            }

            if (!bumperId) return;

            const remindAt = Date.now() + CARL_COOLDOWN_MS;

            // Upsert: one reminder per user per server, replace any pending one
            await BumpReminder.deleteMany({
                type: 'carl', guildId: guildFilter(guildId), userId: bumperId, notified: false
            });
            const record = await BumpReminder.create({ type: 'carl', guildId, userId: bumperId, remindAt });

            scheduleCarlReminder(client, record);

            console.log(`[BUMP] Carl bump by ${bumperId} in ${guildId} — reminder scheduled`);
            return;
        }

        //------------------------------------------------
        // DISBOARD BUMP DETECTED
        //------------------------------------------------
        if (isDisboardBump(message)) {
            const remindAt = Date.now() + DISBOARD_COOLDOWN_MS;

            // One Disboard reminder per server at a time
            await BumpReminder.deleteMany({ type: 'disboard', guildId: guildFilter(guildId), notified: false });
            const record = await BumpReminder.create({ type: 'disboard', guildId, remindAt });

            scheduleDisboardReminder(client, record);

            console.log(`[BUMP] Disboard bump in ${guildId} — reminder scheduled in 2h`);
            return;
        }
    });
};

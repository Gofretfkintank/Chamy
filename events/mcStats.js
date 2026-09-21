//--------------------------------
// MC STATS EVENT  (v2)
// Fetches live Exaroton server data every 5 minutes
// and keeps a single auto-updating embed in #sv-stats.
//
// Tracks: status, player list, address, software,
//         uptime, peak players, RAM, credits, Java.
//
// The Exaroton account is OM's, so the embed lives in the home guild; the
// channel comes from that guild's config (minecraft:statsChannel).
//--------------------------------

const { EmbedBuilder } = require('discord.js');
const axios            = require('axios');
const cfg              = require('../lib/guildConfig');
const { LEGACY_GUILD_ID, seedLegacyGuild } = require('../lib/legacySeed');

//--------------------------------
// CONFIG
//--------------------------------
const API              = 'https://api.exaroton.com/v1';
const UPDATE_INTERVAL  = 5 * 60 * 1000; // 5 minutes

const HEADERS = () => ({ Authorization: `Bearer ${process.env.EXAROTON_API_KEY}` });

//--------------------------------
// STATUS MAPS
//--------------------------------
const STATUS_LABEL = {
    0:  'Offline',
    1:  'Online',
    2:  'Starting',
    3:  'Stopping',
    4:  'Restarting',
    5:  'Saving',
    6:  'Loading',
    7:  'Crashed',
    8:  'Pending',
    10: 'Preparing'
};

const STATUS_COLOR = {
    0:  0x636E72,  // grey    — offline
    1:  0x2ECC71,  // green   — online
    2:  0xF39C12,  // amber   — starting / stopping
    3:  0xE74C3C,  // red     — stopping
    4:  0xF39C12,  // amber   — restarting
    5:  0x3498DB,  // blue    — saving / loading
    6:  0x3498DB,
    7:  0xC0392B,  // crimson — crashed
    8:  0xF39C12,
    10: 0xF39C12
};

const STATUS_EMOJI = {
    0:  '⚫',
    1:  '🟢',
    2:  '🟡',
    3:  '🔴',
    4:  '🟡',
    5:  '🔵',
    6:  '🔵',
    7:  '💥',
    8:  '🟡',
    10: '🟡'
};

//--------------------------------
// SESSION STATE
// (In-memory, resets on bot restart)
//--------------------------------
let cachedServerId   = null;
let serverOnlineSince = null;  // ms timestamp when server went Online
let lastKnownStatus  = null;   // detect status transitions
let peakPlayers      = 0;      // max concurrent players this session

//--------------------------------
// HELPERS
//--------------------------------
function stripMotd(str) {
    return (str ?? '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

function fmt(credits) {
    if (credits == null) return '`—`';
    return `\`${parseFloat(credits).toFixed(2)} cr\``;
}

//--------------------------------
// API CALLS
//--------------------------------
async function fetchServerData() {
    if (!cachedServerId) {
        const listRes = await axios.get(`${API}/servers/`, { headers: HEADERS() });
        const servers = listRes.data?.data ?? [];
        if (!servers.length) return null;
        cachedServerId = servers[0].id;
    }
    const res = await axios.get(`${API}/servers/${cachedServerId}/`, { headers: HEADERS() });
    return res.data?.data ?? null;
}

async function fetchCredits() {
    try {
        const res = await axios.get(`${API}/account/`, { headers: HEADERS() });
        return res.data?.data?.credits ?? null;
    } catch {
        return null;
    }
}

//--------------------------------
// BUILD EMBED
//--------------------------------
function buildEmbed(server, credits) {
    const status  = server.status   ?? 0;
    const label   = STATUS_LABEL[status] ?? 'Unknown';
    const color   = STATUS_COLOR[status]  ?? 0x636E72;
    const emoji   = STATUS_EMOJI[status]  ?? '❓';

    const serverName = server.name    ?? 'OM Minecraft Server';
    const address    = server.address ?? '—';
    const motd       = server.motd ? stripMotd(server.motd) : null;
    const software   = server.software;
    const java       = server.java;
    const ram        = server.ram; // in GB on Exaroton

    const isOnline    = status === 1;
    const onlineCount = server.players?.online ?? 0;
    const maxCount    = server.players?.max    ?? 20;
    const rawList     = server.players?.list   ?? [];

    const playerNames = rawList.map(p =>
        typeof p === 'string' ? p : (p.name ?? String(p))
    );

    // ── Track uptime & peak
    if (isOnline && lastKnownStatus !== 1) serverOnlineSince = Date.now();
    if (!isOnline)                         serverOnlineSince = null;
    if (isOnline) peakPlayers = Math.max(peakPlayers, onlineCount);
    lastKnownStatus = status;

    // ── Field values
    const statusVal  = `${emoji} \`${label}\``;
    const playersVal = isOnline ? `\`${onlineCount} / ${maxCount}\`` : '`—`';
    const addressVal = `\`${address}\``;
    const softwareVal = software?.name
        ? `\`${software.name}${software.version ? ` ${software.version}` : ''}\``
        : '`—`';
    const javaVal    = java?.version ? `\`Java ${java.version}\`` : '`—`';
    const ramVal     = ram != null ? `\`${ram} GB\`` : '`—`';

    const uptimeVal  = isOnline && serverOnlineSince
        ? `<t:${Math.floor(serverOnlineSince / 1000)}:R>`
        : '`—`';

    const peakVal    = peakPlayers > 0 ? `\`${peakPlayers} players\`` : '`—`';
    const creditsVal = fmt(credits);

    // ── Player list
    let playerListText;
    if (!isOnline)              playerListText = '*Server is offline*';
    else if (!playerNames.length) playerListText = '*No players online right now*';
    else                         playerListText = playerNames.map(n => `\`${n}\``).join('  ');

    // ── Assemble embed
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji}  ${serverName}`)
        .addFields(
            // Row 1 — core status
            { name: '📡 Status',    value: statusVal,   inline: true },
            { name: '👥 Players',   value: playersVal,  inline: true },
            { name: '🌐 Address',   value: addressVal,  inline: true },

            // Row 2 — server info
            { name: '⚙️ Software',  value: softwareVal, inline: true },
            { name: '☕ Java',       value: javaVal,     inline: true },
            { name: '🧠 RAM',        value: ramVal,      inline: true },

            // Row 3 — session stats
            { name: '⏱️ Online Since', value: uptimeVal,   inline: true },
            { name: '🏆 Peak (Session)', value: peakVal,  inline: true },
            { name: '💰 Credits',     value: creditsVal,  inline: true },

            // Row 4 — player list (full width)
            { name: '\u200b',        value: '\u200b',    inline: false },
            { name: '📋 Online Now', value: playerListText, inline: false }
        )
        .setFooter({ text: 'Olzhasstik Motorsports • Minecraft  •  Auto-refreshes every 5 min' })
        .setTimestamp();

    if (motd) embed.setDescription(`*${motd}*`);

    return embed;
}

function buildErrorEmbed(title, desc) {
    return new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle(`❌  ${title}`)
        .setDescription(desc)
        .setFooter({ text: 'Olzhasstik Motorsports • Minecraft  •  Auto-refreshes every 5 min' })
        .setTimestamp();
}

//--------------------------------
// MAIN EXPORT
//--------------------------------
module.exports = (client) => {

    let statsMessageId = null;

    client.once('ready', async () => {

        // This 'ready' fires before index.js seeds the home guild's config, so
        // on the first boot after the migration it must wait for that or it
        // would find no channel and never start the loop.
        await seedLegacyGuild();

        const statsChannelId = await cfg.get(LEGACY_GUILD_ID, 'minecraft:statsChannel');
        const channel = statsChannelId
            ? await client.channels.fetch(statsChannelId).catch(() => null)
            : null;
        if (!channel) {
            console.error('[mcStats] ❌ No stats channel — set minecraft:statsChannel in the home guild with /config.');
            return;
        }

        // Recover existing stats embed on restart
        try {
            const recent  = await channel.messages.fetch({ limit: 20 });
            const found   = recent.find(m =>
                m.author.id === client.user.id &&
                m.embeds.length > 0 &&
                m.embeds[0]?.footer?.text?.includes('Auto-refreshes every 5 min')
            );
            if (found) {
                statsMessageId = found.id;
                console.log(`[mcStats] 🔁 Recovered existing embed (${statsMessageId}).`);
            }
        } catch (err) {
            console.warn('[mcStats] Could not scan channel history:', err.message);
        }

        //--------------------------------
        // TICK
        //--------------------------------
        async function tick() {
            let embed;
            try {
                const [server, credits] = await Promise.all([
                    fetchServerData(),
                    fetchCredits()
                ]);

                if (!server) {
                    embed = buildErrorEmbed(
                        'No Server Found',
                        'No servers found on this Exaroton account.\nCheck `EXAROTON_API_KEY` in Railway Variables.'
                    );
                } else {
                    embed = buildEmbed(server, credits);
                }
            } catch (err) {
                console.error('[mcStats] API error:', err.message);
                cachedServerId = null; // reset in case of auth issue
                embed = buildErrorEmbed(
                    'Stats Unavailable',
                    `Could not reach Exaroton API.\n\`\`\`${err.message}\`\`\``
                );
            }

            // Edit existing or post new
            try {
                if (statsMessageId) {
                    const msg = await channel.messages.fetch(statsMessageId).catch(() => null);
                    if (msg) {
                        await msg.edit({ embeds: [embed] });
                        console.log('[mcStats] ✅ Embed updated.');
                        return;
                    }
                    statsMessageId = null;
                }
                const sent     = await channel.send({ embeds: [embed] });
                statsMessageId = sent.id;
                console.log('[mcStats] ✅ Embed posted.');
            } catch (err) {
                console.error('[mcStats] Post/edit failed:', err.message);
            }
        }

        await tick();
        setInterval(tick, UPDATE_INTERVAL);
        console.log('[mcStats] 📡 Stats loop started (5 min interval).');
    });
};

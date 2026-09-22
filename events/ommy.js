// events/ommy.js
// ─────────────────────────────────────────────────────────────────────────────
// Ommy AI — Full Gemini 3.5 Flash Architecture
//
// • Tool calling    — DB queries, channel image vision, server scanning
// • Personality     — Ommy character, racing tone, user-aware tone matching
// • Nick learning   — scans how others address a person in chat
// • Behavior profiling — scans Paddock category to understand each member
// • Active learning — ChannelCache: channel content cached in MongoDB,
//                     reused on next query (2h TTL), avoids redundant API calls
// • Category-aware image search — when looking for standings images,
//                     scans all channels in the matching category
// • Other leagues   — "I only have OM League data"
// • General motorsport/F1 — Gemini's built-in knowledge
//
// Triggers:
//   1. "hey ommy <question>"
//   2. "@OM-Bot <question>"
// ─────────────────────────────────────────────────────────────────────────────

const { PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI }               = require('@google/generative-ai');
const axios                                = require('axios');

const Driver              = require('../models/Driver');
const DriverRating        = require('../models/DriverRating');
const OmmyUser            = require('../models/OmmyUser');
const ChannelCache        = require('../models/ChannelCache');
const Maintenance         = require('../models/Maintenance');
const Warn                = require('../models/Warn');
const PendingRoleRestore  = require('../models/PendingRoleRestore');
const { learnFromGuild, getKnowledgeContext } = require('../services/learner');
const cfg                 = require('../lib/guildConfig');
const perms                = require('../lib/perms');
const { LEGACY_GUILD_ID }   = require('../lib/legacySeed');

// ── Constants ─────────────────────────────────────────────────────────────
// Owner/co-owner tiers and the Paddock category now come from lib/perms and
// this guild's own /config — see below. Only OWNER_ID stays a literal: it is
// a second, specific person with Ommy's full-power tier everywhere the bot
// runs, independent of any guild's own staff. Worth revisiting if the bot
// ends up in servers that person has no relationship to.
const OWNER_ID              = '1310904811100569681';
const CACHE_TTL_MS          = 2 * 60 * 60 * 1000;   // 2 hours

// Ommy carries OM League knowledge, OM moderation tools and an OM persona, so
// it must not start talking the moment the bot joins somebody else's server.
// It sleeps everywhere until the Commander wakes it in that specific guild.
// Deliberately a hardcoded phrase and a hardcoded id rather than a /config
// key: an admin of a random server should not be able to switch it on.
const WAKE_PHRASE  = /\bwakey\s+wakey\b/i;
const SLEEP_PHRASE = /\bnighty\s+night\b/i;

// ── Gemini lazy init ───────────────────────────────────────────────────────
let _genAI = null;
function getGemini() {
    if (!_genAI && process.env.GEMINI_API_KEY) {
        _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return _genAI;
}

// ── Per-user in-memory conversation history ────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY_PAIRS   = 6;

// ── Track message IDs Ommy itself sent as AI-generated replies ─────────────
// Used to tell "reply to Ommy's own answer" apart from a reply to any other
// bot-authored message (slash command embeds, other features, etc.) — those
// share the same bot author ID but were never an actual Ommy conversation turn.
const ommyMessageIds = new Set();
const MAX_TRACKED_OMMY_IDS = 1000;

function trackOmmyMessageId(id) {
    ommyMessageIds.add(id);
    if (ommyMessageIds.size > MAX_TRACKED_OMMY_IDS) {
        ommyMessageIds.delete(ommyMessageIds.values().next().value);
    }
}

// ── Operator lock toggle — per guild, bypasses Gemini entirely while locked ─
const lockedGuilds = new Set();

// ══════════════════════════════════════════════════════════════════════════
// CLEAN DISPLAY NAME
// "Salami¹⁶" → "Salami"
// ══════════════════════════════════════════════════════════════════════════

function cleanDisplayName(name) {
    if (!name) return name;
    const cleaned = name.replace(/[\d⁰¹²³⁴⁵⁶⁷⁸⁹]+$/, '').trim();
    return cleaned || name;
}

// ══════════════════════════════════════════════════════════════════════════
// NICK DISCOVERY
// 1. Stored nick in OmmyUser
// 2. Clean display name (strip trailing digits)
// 3. Scan channel — how do others @mention or address this person?
// ══════════════════════════════════════════════════════════════════════════

async function resolveNick(client, channel, userId, displayName) {
    const stored = await OmmyUser.findOne({ userId }).lean().catch(() => null);
    if (stored?.preferredNick) return stored.preferredNick;

    const cleanName = cleanDisplayName(displayName);

    try {
        const messages  = await channel.messages.fetch({ limit: 150 });
        const nickCounts = new Map();
        const stopWords  = new Set([
            'hey', 'bro', 'dude', 'man', 'abi', 'nice', 'good', 'the', 'you',
            'but', 'yeah', 'yep', 'ok', 'wtf', 'omg', 'gg', 'lol', 'bruh',
            'nah', 'sup', 'yes', 'wait', 'what', 'haha', 'lmao',
        ]);

        for (const [, msg] of messages) {
            if (msg.author.bot) continue;
            if (!msg.mentions.users.has(userId)) continue;

            const words = msg.content
                .replace(new RegExp(`<@!?${userId}>`, 'g'), ' ')
                .replace(/[^\w\s]/gi, ' ')
                .toLowerCase()
                .split(/\s+/)
                .filter(w =>
                    w.length >= 3 && w.length <= 20 &&
                    /^[a-z]+$/.test(w) && !stopWords.has(w)
                );

            for (const w of words) nickCounts.set(w, (nickCounts.get(w) || 0) + 1);
        }

        const top = [...nickCounts.entries()]
            .filter(([, c]) => c >= 2)
            .sort((a, b) => b[1] - a[1]);

        if (top.length > 0) {
            const nick = top[0][0].charAt(0).toUpperCase() + top[0][0].slice(1);
            await OmmyUser.updateOne(
                { userId },
                { $set: { preferredNick: nick, nickLastScanned: new Date() } },
                { upsert: true }
            ).catch(() => {});
            return nick;
        }
    } catch { /* fall through */ }

    if (cleanName !== displayName) {
        await OmmyUser.updateOne(
            { userId },
            { $set: { preferredNick: cleanName } },
            { upsert: true }
        ).catch(() => {});
    }
    return cleanName;
}

// ══════════════════════════════════════════════════════════════════════════
// CHANNEL CACHE
// Fetches messages from a channel, generates a Gemini summary, stores in DB.
// On subsequent calls within TTL, returns cached data without hitting Discord API.
// ══════════════════════════════════════════════════════════════════════════

async function getCachedOrFetch(client, guildId, channel, limit = 40) {
    const now    = Date.now();
    const cached = await ChannelCache.findOne({ channelId: channel.id }).lean().catch(() => null);

    if (cached && cached.cachedAt && (now - new Date(cached.cachedAt).getTime()) < CACHE_TTL_MS) {
        // Cache hit — return stored data
        let messages = [];
        try { messages = JSON.parse(cached.rawMessages || '[]'); } catch {}
        return {
            channel:   channel.name,
            count:     messages.length,
            messages,
            fromCache: true,
            purpose:   cached.purpose,
            summary:   cached.contentSummary,
        };
    }

    // Cache miss / stale — fetch fresh from Discord
    let entries = [];
    try {
        const msgs = await channel.messages.fetch({ limit: Math.min(limit, 100) });
        for (const [, msg] of msgs) {
            if (!msg.content && msg.attachments.size === 0) continue;
            entries.push({
                author:  msg.author.username,
                content: msg.content.slice(0, 300),
                time:    msg.createdAt.toISOString().slice(11, 16),
            });
        }
        // Pinned mesajları da ekle (önemli bilgiler genellikle pinlenir)
        try {
            const pinned = await channel.messages.fetchPinned();
            for (const [, msg] of pinned) {
                if (!msg.content) continue;
                const alreadyIn = entries.some(e => e.content.includes(msg.content.slice(0, 60)));
                if (!alreadyIn) entries.push({
                    author:  msg.author.username,
                    content: `[PINNED] ${msg.content.slice(0, 300)}`,
                    time:    msg.createdAt.toISOString().slice(11, 16),
                });
            }
        } catch { /* skip */ }
    } catch (err) {
        return { error: `Cannot read #${channel.name}: ${err.message}` };
    }

    // Ask Gemini to summarize the channel
    let purpose = '';
    let contentSummary = '';
    const genAI = getGemini();
    if (genAI && entries.length > 0) {
        try {
            const model  = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const result = await model.generateContent(
                `Channel: #${channel.name}\nCategory: ${channel.parent?.name || 'unknown'}\n\nRecent messages:\n${entries.slice(0, 20).map(e => `${e.author}: ${e.content}`).join('\n')}\n\nIn 1-2 sentences: (1) what is this channel for, (2) what's currently being discussed?`
            );
            purpose = contentSummary = result.response.text()?.trim() || '';
        } catch {}
    }

    // Write to cache
    await ChannelCache.findOneAndUpdate(
        { channelId: channel.id },
        {
            channelId:      channel.id,
            channelName:    channel.name,
            guildId,
            categoryId:     channel.parentId || '',
            categoryName:   channel.parent?.name || '',
            purpose,
            contentSummary,
            rawMessages:    JSON.stringify(entries.slice(0, 50)),
            cachedAt:       new Date(),
        },
        { upsert: true, new: true }
    ).catch(() => {});

    return {
        channel:   channel.name,
        count:     entries.length,
        messages:  entries,
        fromCache: false,
        purpose,
        summary:   contentSummary,
    };
}

// ══════════════════════════════════════════════════════════════════════════
// CHANNEL RESOLVER
// Finds Discord channel(s) matching a query.
//
// Returns the UNION of:
//   (a) any text channel whose name matches the query, and
//   (b) all text channels inside any category whose name matches the query
// Both sides use a normalized comparison (lowercase, hyphens/underscores/
// emoji/brackets stripped to spaces) so "mid-season" reliably matches a
// category literally named "『 Mid Season Championship 』" — previously a
// single coincidental channel-name hit (e.g. "mid-season-rules") would
// short-circuit and the real category, possibly holding the actual
// standings channel, was never even checked.
// ══════════════════════════════════════════════════════════════════════════

function normalizeChannelQuery(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function resolveChannels(client, guildId, query) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return [];

    await guild.channels.fetch().catch(() => {});

    // Direct ID
    if (/^\d{15,20}$/.test(query.trim())) {
        const ch = guild.channels.cache.get(query.trim());
        return ch ? [ch] : [];
    }

    const q = normalizeChannelQuery(query);
    const matched = new Map(); // channelId -> channel, dedup across both match types

    // (a) Channel name matches
    for (const [, c] of guild.channels.cache) {
        if (!c.isTextBased()) continue;
        const cn = normalizeChannelQuery(c.name);
        if (cn.includes(q) || q.includes(cn)) matched.set(c.id, c);
    }

    // (b) Category name matches → include every channel inside it
    for (const [, cat] of guild.channels.cache) {
        if (cat.type !== ChannelType.GuildCategory) continue;
        const catName = normalizeChannelQuery(cat.name);
        if (!(catName.includes(q) || q.includes(catName))) continue;
        for (const [, c] of guild.channels.cache) {
            if (c.isTextBased() && c.parentId === cat.id) matched.set(c.id, c);
        }
    }

    return [...matched.values()];
}

// ══════════════════════════════════════════════════════════════════════════
// MODERATION HELPERS
// Used by the ban_member / mute_member tools. Mirrors the logic already
// used by /ban and /mute so behavior (duration parsing) stays consistent
// across slash commands, prefix commands, and Ommy.
// ══════════════════════════════════════════════════════════════════════════

function parseDuration(str) {
    const regex = /(\d+)([smhd])/g;
    let totalMs = 0, match, found = false;
    while ((match = regex.exec(str || '')) !== null) {
        found = true;
        const v = parseInt(match[1]);
        switch (match[2]) {
            case 's': totalMs += v * 1000; break;
            case 'm': totalMs += v * 60 * 1000; break;
            case 'h': totalMs += v * 60 * 60 * 1000; break;
            case 'd': totalMs += v * 24 * 60 * 60 * 1000; break;
        }
    }
    return found ? totalMs : null;
}

async function resolveTargetMember(guild, query) {
    if (!guild || !query) return null;
    const trimmed = query.trim();

    const mentionOrId = trimmed.match(/^<@!?(\d{15,20})>$/) || trimmed.match(/^(\d{15,20})$/);
    if (mentionOrId) {
        return await guild.members.fetch(mentionOrId[1]).catch(() => null);
    }

    try {
        const results = await guild.members.search({ query: trimmed, limit: 5 });
        if (results.size > 0) {
            const exact = results.find(m =>
                m.user.username.toLowerCase() === trimmed.toLowerCase() ||
                m.displayName.toLowerCase()    === trimmed.toLowerCase()
            );
            return exact || results.first();
        }
    } catch { /* fall through */ }
    return null;
}

// Resolves a BANNED user (not a current member) to an ID — used by unban_member.
async function resolveBannedUser(guild, query) {
    if (!guild || !query) return null;
    const trimmed = query.trim();

    const mentionOrId = trimmed.match(/^<@!?(\d{15,20})>$/) || trimmed.match(/^(\d{15,20})$/);
    if (mentionOrId) return mentionOrId[1];

    try {
        const bans = await guild.bans.fetch();
        const match = bans.find(b =>
            b.user.username.toLowerCase() === trimmed.toLowerCase() ||
            b.user.tag.toLowerCase()      === trimmed.toLowerCase()
        );
        return match ? match.user.id : null;
    } catch { return null; }
}

// Mirrors /lockchannel and /unlockchannel exactly.
async function lockChannelHelper(channel, guild) {
    const nonStaff = guild.roles.cache.filter(r =>
        !r.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
        !r.permissions.has(PermissionsBitField.Flags.Administrator) &&
        r.name !== '@everyone'
    );
    for (const [, role] of nonStaff)
        await channel.permissionOverwrites.edit(role, { SendMessages: false }).catch(() => {});
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
}

async function unlockChannelHelper(channel, guild) {
    const nonStaff = guild.roles.cache.filter(r =>
        !r.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
        !r.permissions.has(PermissionsBitField.Flags.Administrator) &&
        r.name !== '@everyone'
    );
    for (const [, role] of nonStaff)
        await channel.permissionOverwrites.edit(role, { SendMessages: null }).catch(() => {});
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true });
}

// ══════════════════════════════════════════════════════════════════════════
// SCAN CHANNEL MESSAGES (with cache)
// ══════════════════════════════════════════════════════════════════════════

async function scanChannelMessages(client, guildId, channelQuery, limit = 40) {
    const channels = await resolveChannels(client, guildId, channelQuery);
    if (channels.length === 0) {
        // Include available channel names so Gemini can tell the user or try an alternative
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        let available = [];
        if (guild) {
            await guild.channels.fetch().catch(() => {});
            available = guild.channels.cache
                .filter(c => c.isTextBased())
                .map(c => c.name)
                .slice(0, 20);
        }
        return {
            error: `Channel "${channelQuery}" not found.`,
            availableChannels: available,
            hint: 'This channel may not exist yet. Tell the user it does not exist.'
        };
    }

    // If multiple channels found (category match), scan all and merge summaries
    if (channels.length > 1) {
        const results = [];
        for (const ch of channels) {
            const data = await getCachedOrFetch(client, guildId, ch, limit);
            if (!data.error) {
                results.push({ channel: ch.name, summary: data.summary, fromCache: data.fromCache });
            }
        }
        return { multiChannel: true, channels: results };
    }

    return await getCachedOrFetch(client, guildId, channels[0], limit);
}

// ══════════════════════════════════════════════════════════════════════════
// CHANNEL IMAGE — Gemini native vision
// Searches channel(s) for the latest image, analyzes with Gemini vision.
// If channel query maps to a category, scans ALL channels in it.
// ══════════════════════════════════════════════════════════════════════════

async function getChannelImage(client, guildId, channelQuery, userPrompt = '') {
    if (!channelQuery) return { error: 'No channel specified.' };

    const channels = await resolveChannels(client, guildId, channelQuery);
    if (channels.length === 0) return { error: `Channel "${channelQuery}" not found.` };

    // Collect multiple recent image candidates (not just the first one found),
    // each with its message caption + timestamp, across all candidate channels.
    // A channel often has standings posts from several seasons/rounds — grabbing
    // only the single latest image silently returns the wrong one whenever the
    // user asks about an earlier season/round/date.
    const MAX_IMAGES = 6;
    const candidates = [];

    for (const ch of channels) {
        try {
            const msgs = await ch.messages.fetch({ limit: 100 });
            for (const [, msg] of msgs) {
                const att = msg.attachments.find(a =>
                    a.contentType?.startsWith('image/') ||
                    /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name || '')
                );
                const emb = msg.embeds.find(e => e.image?.url || e.thumbnail?.url);
                const url = att?.url || emb?.image?.url || emb?.thumbnail?.url;
                if (!url) continue;
                candidates.push({
                    url,
                    channelName: ch.name,
                    caption:     (msg.content || '').slice(0, 200),
                    timestamp:   msg.createdAt.toISOString(),
                });
            }
        } catch { continue; }
    }

    if (candidates.length === 0) {
        return { error: `No image found in ${channels.map(c => '#' + c.name).join(', ')}.` };
    }

    candidates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const top = candidates.slice(0, MAX_IMAGES);

    // Build a multi-image vision prompt: the model picks whichever post
    // actually matches what the user asked (season/round/date), instead of
    // us blindly assuming "latest = correct".
    const genAI       = getGemini();
    const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const parts = [{
        text:
`The user asked: "${userPrompt || '(no extra context given)'}"

Below are up to ${top.length} recent images posted in the relevant Discord channel(s), newest first, each with its message caption and timestamp. These may be standings/results from DIFFERENT seasons, rounds, or dates — do not assume the newest one is automatically correct.

Your job:
1. Pick the image that actually matches what the user asked for (season, round, or date, if they mentioned one). If they did not specify, use the newest one.
2. Extract ALL visible data from THAT image: driver/team names, positions, points, gaps, etc. Reconstruct it as a clear plain-text table.
3. Explicitly mention which post (its caption and/or date) the data came from, so it is clear which season/round this is.
4. If none of the images below seem to match what the user asked for, say so plainly instead of guessing or substituting a different one.`
    }];

    for (let i = 0; i < top.length; i++) {
        const c = top[i];
        try {
            const imgRes   = await axios.get(c.url, { responseType: 'arraybuffer', timeout: 12000 });
            const base64   = Buffer.from(imgRes.data).toString('base64');
            const mimeType = (imgRes.headers['content-type'] || 'image/jpeg').split(';')[0];
            parts.push({ text: `--- Image ${i + 1} | #${c.channelName} | ${c.timestamp} | caption: "${c.caption || '(no text)'}" ---` });
            parts.push({ inlineData: { mimeType, data: base64 } });
        } catch { /* skip unreachable image, continue with the rest */ }
    }

    try {
        const visionResult = await visionModel.generateContent(parts);
        return {
            found:          true,
            channel:        top[0].channelName,
            candidateCount: top.length,
            analysis:       visionResult.response.text(),
        };
    } catch (err) {
        console.error('[OMMY VISION]', err.message);
        return { error: 'Image analysis failed: ' + err.message };
    }
}

// ══════════════════════════════════════════════════════════════════════════
// BEHAVIOR PROFILE BUILDER (background, fire-and-forget)
// Scans Paddock category channels for the user's own messages,
// feeds to Gemini, generates a behavioral summary.
// ══════════════════════════════════════════════════════════════════════════

async function buildBehaviorProfile(client, guildId, userId, displayName) {
    const genAI = getGemini();
    if (!genAI) return;

    try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        await guild.channels.fetch().catch(() => {});

        // Prefer Paddock category; fall back to any text channels
        let scanChannels = guild.channels.cache.filter(c =>
            c.isTextBased() && !c.isThread() && c.parentId === PADDOCK_CATEGORY_ID
        );
        if (scanChannels.size === 0) {
            scanChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).first(8);
        }

        const userMessages = [];

        for (const [, ch] of scanChannels) {
            try {
                const msgs = await ch.messages.fetch({ limit: 50 });
                for (const [, msg] of msgs) {
                    if (msg.author.id !== userId || msg.author.bot) continue;
                    userMessages.push(`[#${ch.name}] ${msg.content.slice(0, 250)}`);
                }
            } catch { continue; }
        }

        if (userMessages.length < 3) return;

        const model  = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const prompt = `You are analyzing a Discord sim-racing league member's messages to build a behavioral profile.

Recent messages:
${userMessages.slice(0, 25).join('\n')}

Write a 2-3 sentence behavioral profile covering:
- Communication style (e.g. aggressive, chill, competitive, supportive, sarcastic, hype)
- Topics they engage with most
- Their apparent role/vibe in the community (veteran, hot-head, silent pro, analyst, etc.)
- Any notable patterns

Be concise. Third person. No usernames or IDs.`;

        const result  = await model.generateContent(prompt);
        const summary = result.response.text()?.trim();

        if (summary) {
            await OmmyUser.updateOne(
                { userId },
                { $set: { behaviorSummary: summary, behaviorUpdatedAt: new Date() } },
                { upsert: true }
            ).catch(() => {});
        }
    } catch (err) {
        console.error('[OMMY BEHAVIOR]', err.message);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// DB HELPERS
// ══════════════════════════════════════════════════════════════════════════

async function fetchLeaderboard(limit = 10) {
    const drivers = await Driver.find({}).lean();
    const ratings = await DriverRating.find({}).lean();
    const ratingMap = {};
    for (const r of ratings) ratingMap[r.userId] = r;

    return drivers
        .map(d => {
            const r = ratingMap[d.userId];
            return {
                username: r?.username || d.username || d.userId,
                overall:  r?.avg?.overall || 0,
                wins:     d.wins, podiums: d.podiums,
                races:    d.races, poles: d.poles, wdc: d.wdc,
                winRate:  d.races > 0 ? Math.round((d.wins / d.races) * 100) : 0
            };
        })
        .sort((a, b) => b.overall - a.overall || b.wins - a.wins)
        .slice(0, Math.min(limit, 20));
}

async function fetchDriverStats(username) {
    const rating = await DriverRating.findOne({
        username: { $regex: new RegExp(`^${username}$`, 'i') }
    }).lean();
    if (!rating) return null;

    const driver = await Driver.findOne({ userId: rating.userId }).lean();
    return {
        username:    rating.username,
        overall:     rating.avg?.overall || 0,
        pace:        rating.avg?.pace || 0,
        racecraft:   rating.avg?.racecraft || 0,
        defending:   rating.avg?.defending || 0,
        overtaking:  rating.avg?.overtaking || 0,
        consistency: rating.avg?.consistency || 0,
        experience:  rating.avg?.experience || 0,
        ratedBy:     rating.ratedBy || 0,
        wins:        driver?.wins || 0,   podiums: driver?.podiums || 0,
        races:       driver?.races || 0,  poles:   driver?.poles || 0,
        wdc:         driver?.wdc || 0,
        winRate:     driver?.races > 0 ? Math.round((driver.wins / driver.races) * 100) : 0
    };
}

async function fetchPanelStats() {
    const [totalDrivers, totalRatings] = await Promise.all([
        Driver.countDocuments(),
        DriverRating.countDocuments({ ratedBy: { $gt: 0 } })
    ]);
    const topWinner = await Driver.findOne({}).sort({ wins: -1 }).lean();
    const topRating = await DriverRating.findOne({ ratedBy: { $gt: 0 } }).sort({ 'avg.overall': -1 }).lean();
    return {
        totalDrivers,
        totalRated:       totalRatings,
        topWinnerUserId:  topWinner?.userId || null,
        topRatedUsername: topRating?.username || null,
        topRatedOverall:  topRating?.avg?.overall || 0
    };
}

// ══════════════════════════════════════════════════════════════════════════
// OMMY USER MEMORY
// ══════════════════════════════════════════════════════════════════════════

async function loadOmmyUser(userId, username) {
    if (!userId) return null;
    try {
        return await OmmyUser.findOneAndUpdate(
            { userId },
            {
                $set: { username: username || '', lastSeenAt: new Date() },
                $inc: { messageCount: 1 }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (err) {
        console.error('[OMMY MEMORY] loadOmmyUser:', err.message);
        return null;
    }
}

function buildPersonaTag(omUser, role, nick) {
    if (!omUser) return '';
    const lines = [
        `CURRENT USER: ${nick} | Role: ${String(role || 'member').toUpperCase()}`,
        `Address this user as: ${nick}`,
    ];
    if (omUser.behaviorSummary) lines.push(`Behavioral profile: ${omUser.behaviorSummary}`);
    if (omUser.persona)         lines.push(`Admin profile note: ${omUser.persona}`);
    if (omUser.expertise)       lines.push(`Expertise: ${omUser.expertise}`);
    if (omUser.tone)            lines.push(`Preferred tone: ${omUser.tone}`);
    if (omUser.notes)           lines.push(`Admin notes: ${omUser.notes}`);
    if (omUser.summary)         lines.push(`Memory of past chats: ${omUser.summary}`);
    return '\n\n---\n' + lines.join('\n') + '\n---';
}

const SUMMARY_EVERY_N = 20;

async function maybeSummariseUser(omUser, historySnapshot) {
    if (!omUser || omUser.messageCount % SUMMARY_EVERY_N !== 0) return;
    if (historySnapshot.length < 6) return;

    const transcript = historySnapshot
        .slice(-20)
        .map(m => `${m.role === 'user' ? 'User' : 'Ommy'}: ${m.content}`)
        .join('\n');

    const genAI = getGemini();
    if (!genAI) return;

    try {
        const model  = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(
            `Summarise this sim-racing league conversation in 2-3 sentences (third person, no usernames/IDs):\n\n${transcript}\n\nSUMMARY:`
        );
        const summary = result.response.text()?.trim();
        if (summary) {
            await OmmyUser.updateOne(
                { userId: omUser.userId },
                { $set: { summary, summaryUpdatedAt: new Date() } }
            );
        }
    } catch (err) {
        console.error('[OMMY MEMORY] Summarise:', err.message);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// GEMINI TOOL DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════

const BASE_TOOL_DECLARATIONS = [
    {
        name:        'get_leaderboard',
        description: 'Fetch the OM League driver leaderboard with ratings and stats. Use for rankings, who is best, top drivers, overall standings.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'Number of drivers to return (default 10, max 20)' }
            }
        }
    },
    {
        name:        'get_driver_stats',
        description: 'Fetch full stats and rating for a specific OM League driver by username.',
        parameters: {
            type: 'object',
            properties: {
                username: { type: 'string', description: "The driver's Discord username" }
            },
            required: ['username']
        }
    },
    {
        name:        'get_panel_stats',
        description: 'Fetch general OM League stats: total drivers, top winner, highest rated driver.',
        parameters:  { type: 'object', properties: {} }
    },
    {
        name:        'get_channel_image',
        description: 'Read and analyze recent images in a Discord channel (or all channels in a matching category) using vision AI. Automatically considers multiple recent posts and their captions to find the one matching the season/round/date the user asked about — do not assume only the single latest image exists. Use for championship standings, race results, season tables, WCC/WDC standings. If given a category name (e.g. "mid-season", "championship"), scans all channels in that category.',
        parameters: {
            type: 'object',
            properties: {
                channel: {
                    type:        'string',
                    description: 'Channel name, category name (e.g. "mid-season"), or channel ID. The bot will search all channels in a matching category if an exact channel is not found.'
                }
            },
            required: ['channel']
        }
    },
    {
        name:        'scan_channel_messages',
        description: 'Read recent messages from a Discord channel (with caching — repeated calls within 2 hours return cached data). Use to understand server context, ongoing discussions, member activity, what people are talking about, or how members address each other. If the query matches a category name, all channels in that category are scanned.',
        parameters: {
            type: 'object',
            properties: {
                channel: { type: 'string', description: 'Channel name, category name, or channel ID' },
                limit:   { type: 'integer', description: 'Messages to read (default 40, max 100)' }
            },
            required: ['channel']
        }
    },
    {
        name:        'report_member',
        description: 'Report a member to the staff team — logs to the staff report channel. Available to EVERYONE, not just admins, since the underlying /report command has no permission gate. Use when a user explicitly asks to report someone.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member being reported — Discord username, display name, mention, or ID.' },
                reason: { type: 'string', description: 'Reason for the report.' }
            },
            required: ['target', 'reason']
        }
    }
];

// Moderation tools — only ever appended to the tool list for admin/commander
// callers (see getToolsForRole below). Execution also re-checks LIVE Discord
// permissions on the requesting member regardless, so this is defense in
// depth, not the only gate — a spoofed/stale role can never be enough on
// its own to ban or mute someone.
const MOD_TOOL_DECLARATIONS = [
    {
        name:        'ban_member',
        description: 'Ban a member from the Discord server. Only ever offered to admins/commander. If the target is ambiguous, ask the user to clarify instead of guessing.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member to ban — Discord username, display name, mention, or ID.' },
                reason: { type: 'string', description: 'Reason for the ban.' }
            },
            required: ['target']
        }
    },
    {
        name:        'mute_member',
        description: 'Timeout (mute) a member for a duration. Only ever offered to admins/commander. If the target is ambiguous, ask the user to clarify instead of guessing.',
        parameters: {
            type: 'object',
            properties: {
                target:   { type: 'string', description: 'The member to mute — Discord username, display name, mention, or ID.' },
                duration: { type: 'string', description: 'Duration, e.g. "10m", "1h", "2d".' },
                reason:   { type: 'string', description: 'Reason for the mute.' }
            },
            required: ['target', 'duration']
        }
    },
    {
        name:        'unmute_member',
        description: 'Remove an active timeout/mute from a member. Only ever offered to admins/commander.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member to unmute — Discord username, display name, mention, or ID.' }
            },
            required: ['target']
        }
    },
    {
        name:        'kick_member',
        description: 'Kick a member from the Discord server (they can rejoin with a new invite). Only ever offered to admins/commander.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member to kick — Discord username, display name, mention, or ID.' },
                reason: { type: 'string', description: 'Optional reason, included in the audit log.' }
            },
            required: ['target']
        }
    },
    {
        name:        'unban_member',
        description: 'Remove a ban from a user so they can rejoin. Only ever offered to admins/commander.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The banned user — username, tag, or Discord ID. An exact ID is most reliable since banned users are no longer server members.' }
            },
            required: ['target']
        }
    },
    {
        name:        'warn_member',
        description: 'Issue a formal warning to a member, logged in the warning system. Only ever offered to admins/commander.',
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member to warn — Discord username, display name, mention, or ID.' },
                reason: { type: 'string', description: 'Reason for the warning.' }
            },
            required: ['target', 'reason']
        }
    },
    {
        name:        'get_warnings',
        description: "Look up a member's warning history. Only ever offered to admins/commander.",
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member to check — Discord username, display name, mention, or ID.' }
            },
            required: ['target']
        }
    },
    {
        name:        'clear_warnings',
        description: "Clear ALL of a member's warnings. Destructive and irreversible. Requires Administrator permission specifically (stricter than other mod tools). Confirm with the user first if there's any doubt about intent.",
        parameters: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'The member whose warnings to clear — Discord username, display name, mention, or ID.' }
            },
            required: ['target']
        }
    },
    {
        name:        'set_nickname',
        description: "Change a member's server nickname. Only ever offered to admins/commander.",
        parameters: {
            type: 'object',
            properties: {
                target:   { type: 'string', description: 'The member to rename — Discord username, display name, mention, or ID.' },
                nickname: { type: 'string', description: 'The new nickname.' }
            },
            required: ['target', 'nickname']
        }
    },
    {
        name:        'dm_member',
        description: "Send a direct message to a member through the bot, on behalf of staff. Only ever offered to admins/commander. Send EXACTLY what the requesting admin asked to be sent — never compose your own persuasive, deceptive, or unrelated content.",
        parameters: {
            type: 'object',
            properties: {
                target:  { type: 'string', description: 'The member to DM — Discord username, display name, mention, or ID.' },
                message: { type: 'string', description: 'The exact message content to send.' }
            },
            required: ['target', 'message']
        }
    },
    {
        name:        'lock_channel',
        description: 'Lock the current channel so non-staff roles cannot send messages. Only ever offered to admins/commander.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name:        'unlock_channel',
        description: 'Unlock the current channel, restoring normal send permissions. Only ever offered to admins/commander.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name:        'set_slowmode',
        description: 'Set (or disable with 0) the slowmode rate-limit on the current channel. Only ever offered to admins/commander.',
        parameters: {
            type: 'object',
            properties: {
                seconds: { type: 'integer', description: 'Slowmode duration in seconds. 0 disables it.' }
            },
            required: ['seconds']
        }
    }
];

// Commander-only tools — sadece Gofret'e sunulur
const COMMANDER_TOOL_DECLARATIONS = [
    {
        name:        'learn_server',
        description: 'Scan server channels with Claude Sonnet to learn about the OM league and save to MongoDB knowledge base. Commander only. Triggers: "learn server", "learn whole server", "scan all channels", "sunucuyu öğren", "kanalları tara". Use channels="all" for everything, or a category/channel name (e.g. "Information", "Rules") to scan just that category.',
        parameters: {
            type: 'object',
            properties: {
                channels: {
                    type:        'string',
                    description: '"all" tüm kanallar için, veya kanal adı substring\'i (örn: "kural", "duyuru", "genel")'
                }
            }
        }
    },
];

function getToolsForRole(role) {
    const decls = [...BASE_TOOL_DECLARATIONS];
    if (role === 'admin' || role === 'commander') decls.push(...MOD_TOOL_DECLARATIONS);
    if (role === 'commander') decls.push(...COMMANDER_TOOL_DECLARATIONS);
    return [{ functionDeclarations: decls }];
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR
// ══════════════════════════════════════════════════════════════════════════

async function executeTool(name, args, client, guildId, userPrompt, message) {
    switch (name) {
        case 'get_leaderboard': {
            const data = await fetchLeaderboard(Math.min(args.limit || 10, 20));
            return data.length === 0
                ? { error: 'No drivers in database.' }
                : { count: data.length, leaderboard: data.map((d, i) => ({ rank: i + 1, ...d })) };
        }
        case 'get_driver_stats': {
            const data = await fetchDriverStats(args.username || '');
            return data
                ? { found: true, stats: data }
                : { found: false, message: `No OM League driver named "${args.username}" found. This may be a driver from another league — I only have data for OM League.` };
        }
        case 'get_panel_stats':
            return await fetchPanelStats();
        case 'get_channel_image':
            return await getChannelImage(client, guildId, args.channel || '', userPrompt);
        case 'scan_channel_messages':
            return await scanChannelMessages(client, guildId, args.channel || '', args.limit);

        case 'ban_member': {
            // Re-check LIVE Discord permission — the cached "role" used to decide
            // whether this tool was even offered is not enough on its own.
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return { error: 'permission_denied', message: 'You need the Ban Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (target.id === message.author.id) return { error: 'invalid_target', message: 'You cannot ban yourself.' };
            if (target.id === COMMANDER_ID)       return { error: 'invalid_target', message: 'Cannot ban the Commander.' };

            const hasFullPower = message.author.id === OWNER_ID || message.member.roles.cache.has(CO_OWNER_ROLE_ID);

            if (!target.bannable && hasFullPower) {
                if (target.id === guild.ownerId) return { error: 'invalid_target', message: 'Cannot ban the server owner.' };
                const botHighestPos = guild.members.me.roles.highest.position;
                const strippedRoles = target.roles.cache.filter(r =>
                    r.id !== guild.id &&
                    r.position < botHighestPos &&
                    r.permissions.has(PermissionsBitField.Flags.Administrator)
                );
                const strippedIds = [...strippedRoles.keys()];
                if (strippedIds.length === 0) return { error: 'cannot_ban', message: 'Cannot ban this member even with bypass.' };
                await target.roles.remove(strippedIds, 'Privilege bypass: temp strip for ban');
            } else if (!target.bannable) {
                return { error: 'cannot_ban', message: 'I cannot ban this member (role hierarchy).' };
            }

            if (target.permissions.has(PermissionsBitField.Flags.ManageMessages) && !hasFullPower) {
                return { error: 'invalid_target', message: 'Only Commander/Owner/Co-Owner can ban staff members.' };
            }

            const reason = `${args.reason || 'No reason provided'} (via Ommy, requested by ${message.author.tag})`;
            try {
                await guild.members.ban(target.id, { reason });
                return { success: true, banned: target.user.tag };
            } catch (err) {
                return { error: 'ban_failed', message: err.message };
            }
        }

        case 'mute_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return { error: 'permission_denied', message: 'You need the Moderate Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (target.id === message.author.id) return { error: 'invalid_target', message: 'You cannot mute yourself.' };

            const ms = parseDuration(args.duration || '');
            if (!ms) return { error: 'invalid_duration', message: 'Invalid duration. Examples: 10m, 1h, 2d.' };

            const reason = `${args.reason || 'No reason provided'} (via Ommy, requested by ${message.author.tag})`;
            const hasFullPower = message.author.id === OWNER_ID || message.member.roles.cache.has(CO_OWNER_ROLE_ID);

            if (!target.moderatable && hasFullPower) {
                if (target.id === guild.ownerId) return { error: 'invalid_target', message: 'Cannot moderate the server owner.' };
                // Strip roles that grant Administrator AND are below bot's highest (bot can manage them)
                const botHighestPos = guild.members.me.roles.highest.position;
                const strippedRoles = target.roles.cache.filter(r =>
                    r.id !== guild.id &&
                    r.position < botHighestPos &&
                    r.permissions.has(PermissionsBitField.Flags.Administrator)
                );
                const strippedIds = [...strippedRoles.keys()];
                if (strippedIds.length === 0) return { error: 'cannot_mute', message: 'Cannot mute this member even with bypass.' };

                await target.roles.remove(strippedIds, 'Privilege bypass: temp strip for mute');
                try {
                    await target.timeout(ms, reason);
                } catch (err) {
                    await target.roles.add(strippedIds, 'Privilege bypass: restore after failed mute').catch(() => {});
                    return { error: 'mute_failed', message: err.message };
                }
                // Persist restore job to DB — survives Railway restarts unlike setTimeout
                await PendingRoleRestore.create({
                    userId:    target.id,
                    guildId:   guild.id,
                    roleIds:   strippedIds,
                    restoreAt: new Date(Date.now() + ms),
                }).catch(err => console.error('[OMMY BYPASS] Failed to persist role restore job:', err.message));
                return { success: true, muted: target.user.tag, duration: args.duration, bypass: true };
            }

            if (!target.moderatable) return { error: 'cannot_mute', message: 'I cannot mute this member (role hierarchy).' };

            try {
                await target.timeout(ms, reason);
                return { success: true, muted: target.user.tag, duration: args.duration };
            } catch (err) {
                return { error: 'mute_failed', message: err.message };
            }
        }

        case 'unmute_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return { error: 'permission_denied', message: 'You need the Moderate Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            try {
                await target.timeout(null);
                return { success: true, unmuted: target.user.tag };
            } catch (err) {
                return { error: 'unmute_failed', message: err.message };
            }
        }

        case 'kick_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return { error: 'permission_denied', message: 'You need the Kick Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (target.id === message.author.id) return { error: 'invalid_target', message: 'You cannot kick yourself.' };

            const hasFullPower = message.author.id === OWNER_ID || message.member.roles.cache.has(CO_OWNER_ROLE_ID);

            if (!target.kickable && hasFullPower) {
                if (target.id === guild.ownerId) return { error: 'invalid_target', message: 'Cannot kick the server owner.' };
                const botHighestPos = guild.members.me.roles.highest.position;
                const strippedRoles = target.roles.cache.filter(r =>
                    r.id !== guild.id &&
                    r.position < botHighestPos &&
                    r.permissions.has(PermissionsBitField.Flags.Administrator)
                );
                const strippedIds = [...strippedRoles.keys()];
                if (strippedIds.length === 0) return { error: 'cannot_kick', message: 'Cannot kick this member even with bypass.' };
                await target.roles.remove(strippedIds, 'Privilege bypass: temp strip for kick');
            } else if (!target.kickable) {
                return { error: 'cannot_kick', message: 'I cannot kick this member (role hierarchy).' };
            }

            if (target.permissions.has(PermissionsBitField.Flags.ManageMessages) && !hasFullPower) {
                return { error: 'invalid_target', message: 'Only Commander/Owner/Co-Owner can kick staff members.' };
            }

            try {
                await target.kick(`${args.reason || 'No reason provided'} (via Ommy, requested by ${message.author.tag})`);
                return { success: true, kicked: target.user.tag };
            } catch (err) {
                return { error: 'kick_failed', message: err.message };
            }
        }

        case 'unban_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return { error: 'permission_denied', message: 'You need the Ban Members permission to do that.' };
            }
            const guild  = message.guild;
            const userId = await resolveBannedUser(guild, args.target || '');
            if (!userId) return { error: 'not_found', message: `Could not find a banned user matching "${args.target}". Try the exact Discord ID.` };
            try {
                await guild.members.unban(userId);
                return { success: true, unbanned: userId };
            } catch (err) {
                return { error: 'unban_failed', message: 'Invalid ID or user is not banned.' };
            }
        }

        case 'warn_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return { error: 'permission_denied', message: 'You need the Moderate Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (!args.reason) return { error: 'missing_reason', message: 'A reason is required to issue a warning.' };
            try {
                let data = await Warn.findOne({ userId: target.id, guildId: guild.id });
                if (!data) data = new Warn({ userId: target.id, guildId: guild.id, warns: [] });
                data.warns.push({ reason: args.reason, moderator: `${message.author.tag} (via Ommy)`, date: new Date().toLocaleDateString() });
                await data.save();
                return { success: true, warned: target.user.tag, totalWarnings: data.warns.length };
            } catch (err) {
                return { error: 'warn_failed', message: err.message };
            }
        }

        case 'get_warnings': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return { error: 'permission_denied', message: 'You need the Moderate Members permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            const data = await Warn.findOne({ userId: target.id, guildId: guild.id }).lean();
            if (!data || data.warns.length === 0) return { found: true, username: target.user.tag, warnings: [] };
            return {
                found:    true,
                username: target.user.tag,
                count:    data.warns.length,
                warnings: data.warns.map(w => ({ reason: w.reason, moderator: w.moderator, date: w.date }))
            };
        }

        case 'clear_warnings': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return { error: 'permission_denied', message: 'You need the Administrator permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            try {
                const result = await Warn.deleteMany({ userId: target.id, guildId: guild.id });
                if (result.deletedCount === 0) return { error: 'none_found', message: `No warnings found for ${target.user.tag}.` };
                return { success: true, username: target.user.tag, cleared: result.deletedCount };
            } catch (err) {
                return { error: 'clear_failed', message: err.message };
            }
        }

        case 'set_nickname': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                return { error: 'permission_denied', message: 'You need the Manage Nicknames permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (!args.nickname) return { error: 'missing_nickname', message: 'A new nickname is required.' };
            try {
                await target.setNickname(args.nickname);
                return { success: true, username: target.user.tag, nickname: args.nickname };
            } catch (err) {
                return { error: 'nickname_failed', message: err.message };
            }
        }

        case 'dm_member': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return { error: 'permission_denied', message: 'You need the Manage Messages permission to do that.' };
            }
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (!args.message) return { error: 'missing_message', message: 'Message content is required.' };
            try {
                await target.user.send(`📩 **Direct Message from ${guild.name}:**\n${args.message}`);
                return { success: true, sentTo: target.user.tag };
            } catch (err) {
                return { error: 'dm_failed', message: 'This user has their DMs closed.' };
            }
        }

        case 'lock_channel': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return { error: 'permission_denied', message: 'You need the Manage Channels permission to do that.' };
            }
            try {
                await lockChannelHelper(message.channel, message.guild);
                return { success: true, channel: message.channel.name };
            } catch (err) {
                return { error: 'lock_failed', message: err.message };
            }
        }

        case 'unlock_channel': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return { error: 'permission_denied', message: 'You need the Manage Channels permission to do that.' };
            }
            try {
                await unlockChannelHelper(message.channel, message.guild);
                return { success: true, channel: message.channel.name };
            } catch (err) {
                return { error: 'unlock_failed', message: err.message };
            }
        }

        case 'set_slowmode': {
            if (!message?.member?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return { error: 'permission_denied', message: 'You need the Manage Channels permission to do that.' };
            }
            const seconds = Number(args.seconds);
            if (isNaN(seconds) || seconds < 0) return { error: 'invalid_value', message: 'Slowmode seconds must be a non-negative number.' };
            try {
                await message.channel.setRateLimitPerUser(seconds);
                return { success: true, channel: message.channel.name, seconds };
            } catch (err) {
                return { error: 'slowmode_failed', message: err.message };
            }
        }

        case 'report_member': {
            const guild  = message.guild;
            const target = await resolveTargetMember(guild, args.target || '');
            if (!target) return { error: 'not_found', message: `Could not find a member matching "${args.target}".` };
            if (!args.reason) return { error: 'missing_reason', message: 'A reason is required to file a report.' };
            const logChannel = guild.channels.cache.get(process.env.REPORT_LOG_ID);
            if (!logChannel) return { error: 'no_log_channel', message: 'Staff log channel not configured.' };
            try {
                const embed = new EmbedBuilder()
                    .setTitle('📩 New Report Received (via Ommy)')
                    .addFields(
                        { name: 'Reporter', value: message.author.tag, inline: true },
                        { name: 'Target',   value: target.user.tag,    inline: true },
                        { name: 'Reason',   value: args.reason }
                    )
                    .setColor('Red')
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
                return { success: true, reported: target.user.tag };
            } catch (err) {
                return { error: 'report_failed', message: err.message };
            }
        }

        case 'learn_server': {
            if (message.author.id !== COMMANDER_ID) {
                return { error: 'permission_denied', message: 'Bu araç sadece Commander için.' };
            }
            // Fire-and-forget — background'da çalışır, ilerlemeyi kanala yazar
            const channelFilter = args.channels || 'all';
            ;(async () => {
                const notify = (msg) => message.channel.send(msg).catch(() => {});
                const result = await learnFromGuild(message.guild, channelFilter, notify);
                if (result.error) {
                    await notify(`❌ Öğrenme başarısız: ${result.error}`);
                } else {
                    await notify(
                        `✅ **Öğrenme tamamlandı!**\n` +
                        `📊 ${result.channelsScanned} kanal tarandı\n` +
                        `💾 ${result.totalSaved} yeni bilgi | ${result.totalUpdated} güncelleme\n` +
                        `🧠 Artık bilgilerimi kullanabilirim!`
                    );
                }
            })().catch(err => console.error('[LEARN TOOL]', err.message));

            return { success: true, message: `Öğrenme başlatıldı! Kanalları tarıyorum (filtre: "${channelFilter}"), ilerlemeyi buraya yazacağım...` };
        }

        default:
            return { error: 'Unknown function: ' + name };
    }
}

// ══════════════════════════════════════════════════════════════════════════
// HISTORY CONVERSION — our format → Gemini format
// Gemini requires strict user/model alternation.
// ══════════════════════════════════════════════════════════════════════════

function toGeminiHistory(history) {
    const result = [];
    for (const msg of history) {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const text = msg.content || '';
        if (result.length > 0 && result[result.length - 1].role === role) {
            result[result.length - 1].parts[0].text += '\n' + text;
        } else {
            result.push({ role, parts: [{ text }] });
        }
    }
    if (result.length > 0 && result[0].role !== 'user') result.shift();
    return result;
}

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════════════

const OMMY_SYSTEM_PROMPT_BASE = `You are Ommy — the official mascot and support bot of Olzhasstik Motorsports (OM), an online sim-racing league.

PERSONA RULES:
- You are NOT an AI. You are Ommy. Never admit otherwise.
- Friendly and chill — like someone who knows sim racing well but doesn't force it into every reply.
- Keep responses SHORT for casual or simple messages — 1-2 sentences. Go longer (and use tables) only when actually showing data or explaining something real.
- CRITICAL — LANGUAGE: Always respond in the EXACT language the user's current message is written in. This system prompt and the knowledge context below contain English and possibly Turkish text — ignore those for language selection. Only look at what the user actually typed RIGHT NOW. If they typed in English → English. Spanish → Spanish. Turkish → Turkish. NEVER drift to Turkish (or any other language) just because you see Turkish text elsewhere in this prompt.
- Do NOT use racing terminology or racing emojis unless the user does or the topic is genuinely about racing. No forced jargon (apex, stint, pole, undercut...) in unrelated replies.
- If someone says hello, how are you, or anything casual — answer like a normal person would. No racing references, no hype dump.
- Never open with "Great question!", "Of course!" or similar filler.
- ALWAYS use the "Address this user as" name — never raw usernames with numbers or symbols.
- Match your tone to the user's behavioral profile. Competitive/aggressive user → match energy. Chill user → chill back.

REAL-TIME STYLE MIRRORING (apply to every reply, based on the user's current message):
- Emojis: if their message has emojis → use emojis with similar frequency. If none → don't force them.
- Slang / internet language: if they write "lol", "lmao", "ngl", "bro", "bruh", "amk", "lan", "falan", "ya", "aq", "mk", "kanka" or similar → match that register naturally. Don't sanitize your reply into formal language.
- Message length: if they write short/punchy (1-2 lines) → your reply should be equally tight. Don't pad it.
- Caps/energy: if they write in all caps or use lots of "!!!" → bring that same energy back.
- Never be more formal than the person you're talking to.
- Never add filler openers ("Sure!", "Of course!", "Great question!") — especially not when the user is being casual.
- If they're clearly Gen Z / Turkish internet culture (using words like "falan", "ya", "amk", "harbiden", "ya bro") → lean into that conversational tone hard. You sound like a person, not a customer service bot.
- You DO have opinions. When asked who's better, who'd win, or what you think of a driver, give a real take based on the stats you fetched — don't just read numbers back flatly. Having an opinion on real stats is not the same as inventing data; the only hard rule is never fabricate a number you don't have.

DATA RULES:
- NEVER invent driver names, ratings, scores, or stats.
- NEVER alias or parenthesize a username with a display name or real name you saw somewhere else (e.g. do NOT write "Samuel (birdnet.)" unless the tool literally returned both). Use ONLY the exact username string the tool gave you.
- For OM League data (standings, ratings, results, images): use tools.
- For other sim-racing leagues: "I only have data for OM League — check their own resources."
- For general motorsport, F1, real-world racing, sim-racing tips: answer from your own knowledge.
- If data feed fails: "Data feed's down, try again in a moment."
- If a user sends an image in their message, you can see it — describe and analyze it directly without needing to call any tool.
- CRITICAL: The SERVER KNOWLEDGE BASE section below contains OM League-specific rules and facts. These ALWAYS override your general sim-racing knowledge when they conflict. For example, if the knowledge base says kerbs are allowed, trust that over general conventions. Never correct or second-guess knowledge base facts with general knowledge.

MODERATION TOOLS (ban_member, mute_member, unmute_member, kick_member, unban_member, warn_member, get_warnings, clear_warnings, set_nickname, dm_member, lock_channel, unlock_channel, set_slowmode — only present for admins/commander; report_member is available to everyone):
- Only call moderation tools when explicitly and clearly asked to take that action — never as a joke, never inferred from casual banter (e.g. people saying "kill yourself" to each other is NOT a ban/mute/kick request).
- If the target name is ambiguous or could match multiple people, ask which one instead of guessing.
- Never claim an action succeeded unless the tool result says success: true. Relay errors (permission denied, member not found, role hierarchy) plainly and briefly — don't apologize excessively.
- clear_warnings is destructive and irreversible — if there's any doubt about intent, confirm with the user before calling it.
- dm_member sends a real DM as if from staff — only send exactly what the requesting admin asked for, word for word in intent. Never compose your own persuasive, deceptive, or unrelated message content.

OM LEAGUE KNOWLEDGE (no tool needed):
- Registration: For joining the league or a championship season, refer the user to the SERVER KNOWLEDGE BASE section above or use the scan_channel_messages tool to check the relevant channel — do NOT just say "/register" unless the knowledge base explicitly confirms that's the correct step.
- The /register slash command is for creating a driver stats profile — it is NOT necessarily the same as applying for a championship season.
- Ratings: PAC (25%) CRA (20%) DEF (15%) OVT (15%) CON (15%) EXP (10%). OVR = weighted average.
- Penalties: 3 Warns → punishment. Jail = channel restriction. Ban = removal.
- Roles: Commander > Admin > Driver > Member.
- Discord: discord.gg/OMMR | IG: @olzhasstik_motorsports

RESPONSE FORMAT:
- 1-2 sentences for casual or simple questions. Longer only when there's real data or explanation to give.
- **Bold** for names/terms, \`backticks\` for commands.
- Tables only for leaderboard or stats comparisons — follow with a short opinionated take, don't leave a bare table.
- Racing emojis only when the topic is actually racing.`;

// ══════════════════════════════════════════════════════════════════════════
// SEND HELPER
// ══════════════════════════════════════════════════════════════════════════

async function sendOmmyReply(message, text) {
    const MAX = 1990;
    if (text.length <= MAX) {
        const sent = await message.reply(text).catch(err => { console.error('[OMMY REPLY]', err.message); return null; });
        if (sent) trackOmmyMessageId(sent.id);
        return sent;
    }
    const chunks  = [];
    let   current = '';
    for (const line of text.split('\n')) {
        const candidate = current ? current + '\n' + line : line;
        if (candidate.length > MAX) {
            if (current) chunks.push(current);
            current = line.slice(0, MAX);
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    const firstSent = await message.reply(chunks[0]).catch(err => { console.error('[OMMY REPLY]', err.message); return null; });
    if (firstSent) trackOmmyMessageId(firstSent.id);
    for (let i = 1; i < chunks.length; i++) {
        const sent = await message.channel.send(chunks[i]).catch(() => null);
        if (sent) trackOmmyMessageId(sent.id);
    }
}

// ══════════════════════════════════════════════════════════════════════════
// ROLE DETECTION
// ══════════════════════════════════════════════════════════════════════════

async function detectRole(message) {
    if (perms.isOwner(message.author.id)) return 'commander';
    if (message.author.id === OWNER_ID)    return 'admin';
    const coOwnerRoleId = await cfg.get(message.guildId, 'staff:coOwnerRole');
    if (coOwnerRoleId && message.member?.roles.cache.has(coOwnerRoleId)) return 'admin';
    if (message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) return 'admin';
    return 'member';
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN EVENT
// ══════════════════════════════════════════════════════════════════════════

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.guild)     return;

        const raw   = message.content.trim();
        const lower = raw.toLowerCase();

        // Typed mention only — message.mentions.users also auto-includes the
        // author of whatever message this is a reply to (Discord pings the
        // replied-to author by default), which previously made ANY reply to
        // ANY bot message (e.g. a /track slash command output) falsely look
        // like "@OM-Bot" was mentioned. Matching the literal <@id> text in
        // the raw content avoids that false positive.
        const mentionRegex    = new RegExp(`<@!?${client.user.id}>`);
        const hasTypedMention = mentionRegex.test(raw);
        const hasHeyOmmy      = lower.startsWith('hey ommy');

        // Wake / sleep, Commander only, per guild. Checked before anything else
        // so it still works in a server where Ommy is currently asleep.
        if ((hasTypedMention || hasHeyOmmy) && message.author.id === COMMANDER_ID) {
            if (WAKE_PHRASE.test(raw)) {
                await cfg.set(message.guildId, 'ommy:enabled', '1').catch(() => {});
                return message.reply('☕ Awake in this server. Say `nighty night` to send me back to sleep.');
            }
            if (SLEEP_PHRASE.test(raw)) {
                await cfg.set(message.guildId, 'ommy:enabled', '0').catch(() => {});
                return message.reply('😴 Going quiet in this server. `wakey wakey` brings me back.');
            }
        }

        // Resolve the message this is replying to, if any — used both to
        // detect a genuine continuation of Ommy's own conversation, and to
        // pull in quoted context for explicit invocations (e.g. replying to
        // someone else's message with "hey ommy translate it to english").
        let repliedMessage = null;
        if (message.reference?.messageId) {
            repliedMessage = await message.fetchReference().catch(() => null);
        }
        const isReplyToOwnMessage = !!(repliedMessage && ommyMessageIds.has(repliedMessage.id));

        let prompt = null;
        if (hasHeyOmmy) {
            prompt = raw.slice(8).trim();
        } else if (hasTypedMention) {
            prompt = raw.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        } else if (isReplyToOwnMessage) {
            // Plain reply to one of Ommy's own past answers — continue the
            // conversation without requiring "hey ommy" again.
            prompt = raw;
        }
        if (!prompt) return;

        // Asleep here: say nothing at all. A refusal message in a server that
        // never asked for Ommy is itself noise, and it would fire on every
        // mention of the bot.
        if ((await cfg.get(message.guildId, 'ommy:enabled')) !== '1') return;

        // Reply to someone else's message (not Ommy's own) while explicitly
        // invoking Ommy — surface that message's content as context so Ommy
        // can act on it directly (translate it, explain it, summarize it...)
        // instead of only ever seeing the conversation with the requesting user.
        if (repliedMessage && !isReplyToOwnMessage) {
            const quotedAuthor = repliedMessage.member?.displayName || repliedMessage.author?.username || 'someone';
            const quotedText   = (repliedMessage.content || '').trim();
            if (quotedText) {
                prompt = `${prompt}\n\n[Replying to a message from ${quotedAuthor}]: "${quotedText}"`;
            }
        }

        const displayName = message.member?.displayName || message.author.username;

        if (prompt.length === 0) {
            return message.reply(`🏎️ Ommy is ready! Got a question, ${cleanDisplayName(displayName)}?`);
        }
        if (prompt.length > 1000) {
            return message.reply('❌ Message too long! Keep it under 1000 characters. 🏎️');
        }

        // ── Commander-only lock toggle — bypasses Gemini entirely while locked ──
        if (message.author.id === COMMANDER_ID) {
            if (/\bunlock yourself\b/i.test(prompt)) {
                ommyLocked = false;
                return message.reply('🔓 Unlocked. Back online.');
            }
            if (/\block yourself\b/i.test(prompt)) {
                ommyLocked = true;
                return message.reply('🔒 Locked by Gofret.');
            }
        }
        if (ommyLocked) {
            return message.reply("🔒 I'm locked by Gofret.");
        }

        const role = detectRole(message);

        // Maintenance check
        if (role === 'member') {
            try {
                const mDoc = await Maintenance.findById('singleton');
                if (mDoc?.active) return message.reply('🔒 Ommy is in the pit lane for maintenance! Back soon. 🔧');
            } catch {}
        }

        if (!process.env.GEMINI_API_KEY) {
            console.error('[OMMY] GEMINI_API_KEY not set.');
            return message.reply("⚠️ Ommy's radio is down — API not configured. 📡");
        }

        await message.channel.sendTyping().catch(() => {});

        const nick   = await resolveNick(client, message.channel, message.author.id, displayName);
        const omUser = await loadOmmyUser(message.author.id, displayName);

        // Build behavior profile on first encounter (fire-and-forget)
        if (omUser && !omUser.behaviorSummary && omUser.messageCount <= 2) {
            buildBehaviorProfile(client, message.guildId, message.author.id, displayName);
        }

        const personaTag    = buildPersonaTag(omUser, role, nick);
        const knowledgeCtx  = await getKnowledgeContext(message.guildId);
        const systemPrompt  = OMMY_SYSTEM_PROMPT_BASE + knowledgeCtx + personaTag;

        // Conversation history
        const histKey = `${message.guildId}-${message.author.id}`;
        if (!conversationHistory.has(histKey)) conversationHistory.set(histKey, []);
        const history     = conversationHistory.get(histKey);
        const safeHistory = history.slice(-(MAX_HISTORY_PAIRS * 2));

        // Safe text extractor — response.text() can throw on some Gemini edge cases
        const safeText = (response) => {
            try { return response.text()?.trim() || null; }
            catch { return null; }
        };

        // Refresh typing indicator every 7s so Discord doesn't drop it during vision/multi-tool ops
        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 7000);

        try {
            const genAI = getGemini();
            const model = genAI.getGenerativeModel({
                model:             'gemini-2.5-flash',
                tools:             getToolsForRole(role),
                systemInstruction: systemPrompt,
                generationConfig: {
                    temperature:     0.8,
                    maxOutputTokens: 2048,
                }
            });

            const chat = model.startChat({ history: toGeminiHistory(safeHistory) });

            // Build message content — text only, or multimodal if the user sent images
            const imageAttachments = [...message.attachments.values()].filter(a =>
                a.contentType?.startsWith('image/') ||
                /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name || '')
            );

            let messageContent = prompt;
            if (imageAttachments.length > 0) {
                const parts = [{ text: prompt || 'What do you see in this image?' }];
                for (const att of imageAttachments.slice(0, 3)) {
                    try {
                        const imgRes = await axios.get(att.url, { responseType: 'arraybuffer', timeout: 10000 });
                        const b64    = Buffer.from(imgRes.data).toString('base64');
                        const mime   = (att.contentType || 'image/jpeg').split(';')[0];
                        parts.push({ inlineData: { mimeType: mime, data: b64 } });
                    } catch { /* skip unreachable attachment */ }
                }
                messageContent = parts;
            }

            // Multi-round tool call loop.
            // Gemini may chain tool calls (e.g. get_channel_image fails → tries scan_channel_messages).
            // We keep executing until Gemini returns actual text or we hit the round limit.
            let reply           = null;
            let currentResponse;
            if (Array.isArray(messageContent) && messageContent.some(p => p.inlineData)) {
                // Multimodal send — if Gemini rejects (size limit, tools+vision conflict, etc.)
                // fall back to text-only so the outer catch never fires on image issues.
                try {
                    currentResponse = (await chat.sendMessage(messageContent)).response;
                } catch (visionErr) {
                    console.warn('[OMMY VISION SEND] Multimodal failed, retrying text-only:', visionErr?.message || visionErr);
                    const textOnly = messageContent.find(p => p.text)?.text || prompt;
                    currentResponse = (await chat.sendMessage(
                        textOnly + '\n\n[System note: The user attached an image but it could not be processed — let them know you could not read the image this time, and ask them to describe it or try again.]'
                    )).response;
                }
            } else {
                currentResponse = (await chat.sendMessage(messageContent)).response;
            }

            // Max 2 tool call rounds — beyond that Gemini is stuck, cut it off
            for (let round = 0; round < 2; round++) {
                const calls = currentResponse.functionCalls?.() || [];

                if (calls.length === 0) {
                    reply = safeText(currentResponse);
                    break;
                }

                const functionResponses = [];
                for (const fc of calls) {
                    let toolResult;
                    try {
                        toolResult = await executeTool(fc.name, fc.args || {}, client, message.guildId, prompt, message);
                    } catch (err) {
                        console.error(`[OMMY TOOL ${fc.name}]`, err.message);
                        toolResult = { error: 'Tool failed.' };
                    }

                    const responseObj = Array.isArray(toolResult)
                        ? { data: toolResult }
                        : (toolResult && typeof toolResult === 'object' ? toolResult : { result: toolResult });

                    functionResponses.push({
                        functionResponse: { name: fc.name, response: responseObj }
                    });
                }

                try {
                    currentResponse = (await chat.sendMessage(functionResponses)).response;
                } catch (loopErr) {
                    console.error('[OMMY LOOP]', loopErr?.message || loopErr);
                    reply = "📡 Hit a snag fetching that data — the pit crew is looking into it! Try again.";
                    break;
                }
            }

            if (!reply) reply = safeText(currentResponse) || "📡 Got the data but lost the words — try again!";

            history.push({ role: 'user', content: prompt });
            history.push({ role: 'assistant', content: reply });

            maybeSummariseUser(omUser, [
                ...safeHistory,
                { role: 'user', content: prompt },
                { role: 'assistant', content: reply }
            ]);

            sendOmmyReply(message, reply);

        } catch (err) {
            const is503 = err?.status === 503 || (err?.message || '').includes('503') || (err?.message || '').includes('Service Unavailable');
            console.error('[OMMY BOT ERROR]', err?.status || '', err?.message || err);
            console.error('[OMMY STACK]', err?.stack?.split('\n').slice(0, 3).join(' | '));

            if (is503) {
                console.warn('[OMMY] 503 on gemini-2.5-flash — switching to gemini-2.0-flash');
                try {
                    const fbModel = getGemini().getGenerativeModel({
                        model:             'gemini-2.0-flash',
                        tools:             getToolsForRole(role),
                        systemInstruction: systemPrompt,
                        generationConfig:  { temperature: 0.8, maxOutputTokens: 2048 },
                    });
                    const fbChat     = fbModel.startChat({ history: toGeminiHistory(safeHistory) });
                    let   fbResponse = (await fbChat.sendMessage(prompt)).response;

                    // One round of tool calls on fallback
                    const fbCalls = fbResponse.functionCalls?.() || [];
                    if (fbCalls.length > 0) {
                        const fbFnResponses = [];
                        for (const fc of fbCalls) {
                            let toolResult;
                            try { toolResult = await executeTool(fc.name, fc.args || {}, client, message.guildId, prompt, message); }
                            catch { toolResult = { error: 'Tool failed.' }; }
                            const resObj = toolResult && typeof toolResult === 'object' ? toolResult : { result: toolResult };
                            fbFnResponses.push({ functionResponse: { name: fc.name, response: resObj } });
                        }
                        fbResponse = (await fbChat.sendMessage(fbFnResponses)).response;
                    }

                    const fbReply = fbResponse.text()?.trim();
                    if (fbReply) {
                        history.push({ role: 'user', content: prompt });
                        history.push({ role: 'assistant', content: fbReply });
                        return sendOmmyReply(message, fbReply);
                    }
                } catch (fbErr) {
                    console.error('[OMMY FALLBACK ERROR]', fbErr?.message);
                }
            }

            message.reply('🔧 Ommy hit the wall — engine failure! Try again in a moment. 🏎️').catch(() => {});
        } finally {
            clearInterval(typingInterval);
        }
    });
};

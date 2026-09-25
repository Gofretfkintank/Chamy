const SCHEDULER_INTERVAL_MS = 15 * 1000;

function sessionDisplay(type) {
    const value = String(type || '').toUpperCase();
    if (value === 'RACE') return 'Race';
    if (value === 'SPRINT') return 'Sprint';
    if (value === 'PRACTICE') return 'Practice';
    if (value === 'WARMUP') return 'Warm Up';
    return 'Qualifying';
}

function tyreFor(config, weather, type) {
    const condition = String(weather || 'DRY').toUpperCase();
    const sessionType = String(type || 'QUALIFYING').toUpperCase();
    return String(config[`TYRE_${condition}_${sessionType}`] ||
        config[`TYRE_DRY_${sessionType}`] || 'medium').toUpperCase();
}

function seriesRoleId(config, guildId, series) {
    const prefix = `AETHER_GUILD_${String(guildId)}_`;
    const configured = config[`${prefix}SERIES_ROLE_ID_${String(series || 'F1').toUpperCase()}`];
    return configured || config[`${prefix}ALLOWED_ROLE_IDS`]?.[0] ||
        config[`SERIES_ROLE_ID_${String(series || 'F1').toUpperCase()}`] || config.LEAGUE_ROLE_ID || '';
}

function buildAnnouncement(session, config) {
    const series = String(session.series || 'F1').toUpperCase();
    const roleId = seriesRoleId(config, session.guildId, series);
    const roleMention = roleId ? `<@&${roleId}>` : '';
    const weather = String(session.weather || 'DRY').toUpperCase();
    const tyre = tyreFor(config, weather, session.sessionType);
    const maxRounds = Number(config[`SERIES_MAX_ROUNDS_${series}`] || 0);
    const round = maxRounds ? `${session.roundNumber || 0}/${maxRounds}` : `${session.roundNumber || 0}`;
    const condition = weather === 'WET' ? 'WET Conditions 🌧️' : 'DRY Conditions ☀️';
    const trackLimits = String(config.TRACK_LIMITS ?? 'true').toLowerCase() === 'true'
        ? 'Track Limits ON' : 'Track Limits OFF';
    return [
        `# ${session.raceCountry || 'Unknown'} ${session.raceFlag || ''}`,
        `## Round ${round}`,
        `### ${sessionDisplay(session.sessionType)}`,
        '',
        '**The Session will take place from now until:',
        '',
        `<t:${Math.trunc(session.endTs || 0)}:F>**`,
        '',
        '**The Session requires:',
        '',
        `- ${condition}`,
        `- ${tyre} Tyres (5 Sets/Tries)`,
        `- ${trackLimits}`,
        '- Standard Mode**',
        '',
        roleMention,
        '# ────────────────────────────'
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

async function sendAnnouncement(client, session, aether) {
    if (session.quietMode) {
        await aether.AetherSession.updateOne(
            { _id: session._id, $or: [{ announcementSentAt: { $exists: false } }, { announcementSentAt: null }] },
            { $set: { announcementSentAt: new Date() } }
        );
        return;
    }
    const guild = await client.guilds.fetch(String(session.guildId)).catch(() => null);
    const channel = guild?.channels?.cache?.get(String(session.channelId)) ||
        (guild ? await guild.channels.fetch(String(session.channelId)).catch(() => null) : null);
    if (!channel?.isTextBased?.()) throw new Error(`Aether announcement channel ${session.channelId} is unavailable`);
    let message = null;
    if (!session.announcementMessageId) {
        message = await channel.send(buildAnnouncement(session, aether.getConfig()));
        await aether.AetherSession.updateOne(
            { _id: session._id, $or: [{ announcementMessageId: { $exists: false } }, { announcementMessageId: null }] },
            { $set: { announcementMessageId: String(message.id) } }
        );
    }
    let leaderboard = null;
    if (!session.leaderboardMessageId) {
        leaderboard = await channel.send(aether.formatLeaderboard(session, [], session.series));
        await aether.AetherSession.updateOne(
            { _id: session._id, $or: [{ leaderboardMessageId: { $exists: false } }, { leaderboardMessageId: null }] },
            { $set: { leaderboardMessageId: String(leaderboard.id) } }
        );
    }
    await aether.AetherSession.updateOne(
        { _id: session._id, $or: [{ announcementSentAt: { $exists: false } }, { announcementSentAt: null }] },
        { $set: { announcementSentAt: new Date() } }
    );
    return { announcement: message, leaderboard };
}

async function updateLeaderboardMessage(client, aether, session, text) {
    if (!session?.leaderboardMessageId) return false;
    const guild = await client.guilds.fetch(String(session.guildId)).catch(() => null);
    const channel = guild ? await guild.channels.fetch(String(session.channelId)).catch(() => null) : null;
    const message = channel ? await channel.messages.fetch(String(session.leaderboardMessageId)).catch(() => null) : null;
    if (!message?.editable) return false;
    await message.edit(text);
    return true;
}

async function reconcile(client, aether) {
    const now = Math.floor(Date.now() / 1000);
    const sessions = await aether.AetherSession.find({
        status: { $in: ['SCHEDULED', 'ACTIVE'] },
        endTs: { $gt: now },
        $or: [{ announcementSentAt: { $exists: false } }, { announcementSentAt: null }]
    }).sort({ startTs: 1 }).limit(100).lean();
    for (const session of sessions) {
        if (Number(session.startTs) > now) continue;
        const claimed = await aether.AetherSession.findOneAndUpdate(
            { _id: session._id, status: { $in: ['SCHEDULED', 'ACTIVE'] }, $or: [{ announcementSentAt: { $exists: false } }, { announcementSentAt: null }] },
            { $set: { status: 'ACTIVE' } },
            { new: true }
        ).lean();
        if (!claimed) continue;
        try {
            await sendAnnouncement(client, claimed, aether);
        } catch (error) {
            console.error(`[AETHER SCHEDULER] session ${session._id}:`, error.message);
        }
    }
    await aether.AetherSession.updateMany(
        { status: 'ACTIVE', endTs: { $lte: now }, completedAt: { $exists: false } },
        { $set: { status: 'ENDED', completedAt: new Date() } }
    );
}

function startAetherScheduler(client, aether) {
    if (client.__aetherScheduler) return client.__aetherScheduler;
    const run = () => reconcile(client, aether).catch(error =>
        console.error('[AETHER SCHEDULER]', error.message)
    );
    const interval = setInterval(run, SCHEDULER_INTERVAL_MS);
    interval.unref?.();
    client.__aetherScheduler = { interval, reconcile: run };
    client.once('ready', run);
    return client.__aetherScheduler;
}

module.exports = { buildAnnouncement, startAetherScheduler, reconcile, updateLeaderboardMessage };

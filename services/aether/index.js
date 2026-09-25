const mongoose = require('mongoose');
const cfg = require('../../lib/guildConfig');
const fs = require('fs');
const path = require('path');
const aetherConfig = require('./config');

const DEFAULT_REDUCTIONS = Object.freeze(aetherConfig.reductions());
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONFIG = aetherConfig.getConfig();
const DISCORD_MESSAGE_LIMIT = Number(CONFIG.DISCORD_MESSAGE_LIMIT || 2000);
const AETHER_RETENTION_MS = 72 * 60 * 60 * 1000;
const EMOJI_FALLBACKS = {
    series: { F1: '<:f1:1487470069268222175>', F2: '<:f2:1493669245958099036>' },
    tyres: {
        soft: '<:soft:1487470481262248116>', medium: '<:medium:1487470434826846412>',
        hard: '<:hard:1487470539235786843>', intermediate: '<:Intermediate:1487470344997568785>',
        wet: '<:wet:1487470385858482298>'
    },
    teams: {}
};
try {
    const teams = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'teams.json'), 'utf8'));
    for (const group of ['F1_teams', 'F2_teams']) {
        for (const [name, value] of Object.entries(teams[group] || {})) {
            if (value?.emoji_format) EMOJI_FALLBACKS.teams[`${group}:${name}`] = value.emoji_format;
        }
    }
    Object.assign(EMOJI_FALLBACKS.series, Object.fromEntries(Object.entries(teams.series_emojis || {}).map(([k, v]) => [k, v.emoji_format])));
    Object.assign(EMOJI_FALLBACKS.tyres, Object.fromEntries(Object.entries(teams.tyre_emojis || {}).map(([k, v]) => [k, v.emoji_format])));
} catch {}

const schema = (definition, options = {}) => new mongoose.Schema(definition, { timestamps: true, ...options });
const AetherRoleConfig = mongoose.models.AetherRoleConfig || mongoose.model('AetherRoleConfig', schema({
    guildId: { type: String, required: true, unique: true, index: true },
    adminRoleIds: { type: [String], default: [] },
    startRoleIds: { type: [String], default: [] },
    roleOrder: { type: [String], default: [] },
    allowedRoleIds: { type: [String], default: [] }
}));
const AetherSession = mongoose.models.AetherSession || mongoose.model('AetherSession', schema({
    legacyId: { type: Number, index: true },
    guildId: { type: String, required: true, index: true }, roundNumber: Number,
    raceCountry: String, raceFlag: { type: String, default: '' }, series: { type: String, default: 'F1' },
    sessionType: { type: String, default: 'RACE' }, startTs: Number, endTs: Number,
    completedAt: Date, announcementSentAt: Date, announcementMessageId: String, leaderboardMessageId: String,
    weather: { type: String, default: 'DRY' }, channelId: String, status: { type: String, default: 'SCHEDULED' },
    quietMode: { type: Boolean, default: false }
}));
const AetherProfile = mongoose.models.AetherProfile || mongoose.model('AetherProfile', schema({
    legacyId: { type: Number, index: true },
    guildId: { type: String, required: true, index: true }, discordUserId: { type: String, required: true },
    discordUsername: { type: String, default: '' }, licenseKey: { type: String, required: true },
    name: { type: String, required: true }, driverNumber: Number, nationality: { type: String, default: '' },
    team: { type: String, default: '' }, currentTeam: { type: String, default: '' },
    series: { type: String, default: 'F1' }, active: { type: Boolean, default: true }
}));
AetherProfile.schema.index({ guildId: 1, discordUserId: 1 }, { unique: true });
AetherProfile.schema.index({ guildId: 1, licenseKey: 1 }, { unique: true });
const AetherSubmission = mongoose.models.AetherSubmission || mongoose.model('AetherSubmission', schema({
    legacyId: { type: Number, index: true }, legacySessionId: Number,
    guildId: { type: String, required: true, index: true }, sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    licenseKey: { type: String, required: true }, lapTimeCs: Number, lapTimeDisplay: String,
    tyre: String, imageProofUrl: String, videoProofUrl: String, imageProofMeta: mongoose.Schema.Types.Mixed,
    videoProofMeta: mongoose.Schema.Types.Mixed, submittedByUserId: String, requestedByUserId: String,
    attempts: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
}));
AetherSubmission.schema.index({ guildId: 1, sessionId: 1, licenseKey: 1 }, { unique: true });
const AetherLicenseKey = mongoose.models.AetherLicenseKey || mongoose.model('AetherLicenseKey', schema({
    guildId: { type: String, required: true, index: true }, licenseKey: { type: String, required: true },
    profileId: mongoose.Schema.Types.ObjectId, active: { type: Boolean, default: true }
}));
AetherLicenseKey.schema.index({ guildId: 1, licenseKey: 1 }, { unique: true });
const AetherQualifyingResult = mongoose.models.AetherQualifyingResult || mongoose.model('AetherQualifyingResult', schema({
    legacyId: { type: Number, index: true }, guildId: { type: String, required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, index: true },
    roundNumber: Number, series: String, raceCountry: String, sessionType: { type: String, default: 'QUALIFYING' },
    licenseKey: String, qualifyingPosition: Number, lapTimeCs: Number, lapTimeDisplay: String,
    legacyData: mongoose.Schema.Types.Mixed
}));
const AetherLegacyPenalty = mongoose.models.AetherLegacyPenalty || mongoose.model('AetherLegacyPenalty', schema({
    legacyId: { type: Number, index: true }, guildId: { type: String, required: true, index: true },
    licenseKey: String, penaltySeconds: Number, reason: String, issuedBy: String, issuedAt: Date,
    sessionId: Number, submissionId: Number, legacyData: mongoose.Schema.Types.Mixed
}));
const AetherEmojiConfig = mongoose.models.AetherEmojiConfig || mongoose.model('AetherEmojiConfig', schema({
    guildId: { type: String, required: true, unique: true, index: true },
    teams: { type: mongoose.Schema.Types.Mixed, default: {} },
    series: { type: mongoose.Schema.Types.Mixed, default: {} },
    tyres: { type: mongoose.Schema.Types.Mixed, default: {} }
}));
// Central Aether document store. Domain models remain strongly typed for
// operational queries, while this collection is the single guild-scoped
// index/cache for profiles, sessions, submissions, reductions, and settings.
const AetherData = mongoose.models.AetherData || mongoose.model('AetherData', schema({
    guildId: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityKey: { type: String, required: true },
    sessionId: { type: String, index: true },
    completedAt: Date,
    expiresAt: { type: Date, index: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { collection: 'aether_data' }));
AetherData.schema.index({ guildId: 1, entityType: 1, entityKey: 1 }, { unique: true });
AetherData.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

async function upsertCentral(entityType, entityKey, data, options = {}) {
    const payload = {
        guildId: String(options.guildId || data.guildId),
        entityType, entityKey: String(entityKey),
        sessionId: options.sessionId ? String(options.sessionId) : undefined,
        completedAt: options.completedAt,
        expiresAt: options.expiresAt,
        data
    };
    if (!payload.guildId) throw new Error('Aether central record requires guildId');
    return AetherData.findOneAndUpdate(
        { guildId: payload.guildId, entityType, entityKey: payload.entityKey },
        { $set: payload }, { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
}

async function cleanupExpiredData(now = new Date()) {
    const cutoff = new Date(now.getTime() - AETHER_RETENTION_MS);
    const sessions = await AetherSession.find({
        status: 'ENDED',
        $or: [
            { completedAt: { $lte: cutoff } },
            { completedAt: { $exists: false }, endTs: { $lte: Math.floor(cutoff.getTime() / 1000) } }
        ]
    }).select('_id guildId').lean();
    let deleted = 0;
    for (const session of sessions) {
        const sessionId = session._id;
        const sessionFilter = { guildId: session.guildId, sessionId };
        deleted += (await AetherSubmission.deleteMany(sessionFilter)).deletedCount || 0;
        deleted += (await AetherQualifyingResult.deleteMany({
            guildId: session.guildId,
            sessionId
        })).deletedCount || 0;
        deleted += (await AetherData.deleteMany({
            guildId: session.guildId,
            $or: [{ entityType: 'session', entityKey: String(sessionId) }, { sessionId: String(sessionId) }]
        })).deletedCount || 0;
        await AetherSession.deleteOne({ _id: sessionId, guildId: session.guildId });
    }
    // TTL handles central records independently; this removes any stale
    // session-scoped records whose parent session was already removed.
    deleted += (await AetherData.deleteMany({
        expiresAt: { $lte: now },
        entityType: { $in: ['session', 'submission', 'qualifying_reduction', 'qualifying_result'] }
    })).deletedCount || 0;
    return { sessions: sessions.length, deleted };
}

let retentionWorker;
function startRetentionWorker() {
    if (retentionWorker) return retentionWorker;
    retentionWorker = setInterval(() => cleanupExpiredData().catch(error => {
        console.error('[AETHER RETENTION]', error.message);
    }), 15 * 60 * 1000);
    retentionWorker.unref?.();
    return retentionWorker;
}

function normalizeIds(value) {
    return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(String).map(s => s.trim()).filter(Boolean))];
}

function firstPresentField(paths) {
    return paths.reduceRight((fallback, field) => ({ $ifNull: [`$${field}`, fallback] }), null);
}

function exactSnowflakeMatch(fieldPaths, expected) {
    const value = firstPresentField(fieldPaths);
    return {
        $and: [
            { $in: [{ $type: value }, ['string', 'long']] },
            { $eq: [{ $convert: { input: value, to: 'string', onError: '', onNull: '' } }, String(expected)] }
        ]
    };
}

function normalizeStoredProfile(profile, guildId, userId) {
    if (!profile) return null;
    const normalized = {
        ...profile,
        guildId: String(profile.guildId ?? profile.guild_id ?? guildId),
        discordUserId: String(profile.discordUserId ?? profile.discord_user_id ?? profile.user_id ?? userId),
        licenseKey: String(profile.licenseKey ?? profile.license_key ?? ''),
        name: String(profile.name ?? profile.driver_name ?? 'Unknown'),
        driverNumber: profile.driverNumber ?? profile.driver_number,
        discordUsername: profile.discordUsername ?? profile.discord_username ?? '',
        currentTeam: profile.currentTeam ?? profile.current_team ?? '',
        active: profile.active !== false
    };
    return normalized;
}

async function findProfileForUser(guildId, userId, options = {}) {
    const normalizedGuildId = String(guildId);
    const normalizedUserId = String(userId);
    const filter = { guildId: normalizedGuildId, discordUserId: normalizedUserId };
    if (options.activeOnly) filter.active = { $ne: false };
    let profile = await AetherProfile.findOne(filter)
        .sort({ active: -1, updatedAt: -1, createdAt: -1 }).lean();

    if (!profile) {
        const [legacyShape] = await AetherProfile.aggregate([
            { $match: { $expr: { $and: [
                exactSnowflakeMatch(['guildId', 'guild_id'], normalizedGuildId),
                exactSnowflakeMatch(['discordUserId', 'discord_user_id', 'user_id'], normalizedUserId)
            ] } } },
            { $sort: { active: -1, updatedAt: -1, createdAt: -1 } },
            { $limit: 1 }
        ]);
        profile = legacyShape || null;
    }

    if (!profile) {
        const central = await AetherData.findOne({
            guildId: normalizedGuildId, entityType: 'profile',
            'data.discordUserId': normalizedUserId
        }).lean();
        profile = central?.data || null;
    }
    if (!profile) {
        const [centralShape] = await AetherData.aggregate([
            { $match: { entityType: 'profile', $expr: { $and: [
                exactSnowflakeMatch(['guildId', 'guild_id'], normalizedGuildId),
                exactSnowflakeMatch([
                    'data.discordUserId', 'data.discord_user_id', 'data.user_id'
                ], normalizedUserId)
            ] } } },
            { $limit: 1 }
        ]);
        profile = centralShape?.data || null;
    }

    const result = normalizeStoredProfile(profile, normalizedGuildId, normalizedUserId);
    if (options.activeOnly && result?.active === false) return null;
    return result;
}

async function findProfileGuildForUser(userId) {
    const [profile] = await AetherProfile.aggregate([
        { $match: { $expr: exactSnowflakeMatch(['discordUserId', 'discord_user_id', 'user_id'], userId) } },
        { $project: { guildId: { $convert: { input: { $ifNull: ['$guildId', '$guild_id'] }, to: 'string', onError: '', onNull: '' } } } },
        { $limit: 1 }
    ]);
    return profile?.guildId || null;
}
function roleIds(member) {
    return new Set(member?.roles?.cache ? [...member.roles.cache.keys()].map(String) : (member?.roles || []).map(r => String(r.id || r)));
}
function roleRank(id, order) {
    const i = order.indexOf(String(id));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}
function hasAllowedRole(member, ids, order = []) {
    const owned = roleIds(member);
    // roleOrder is only a precedence list; it must never turn an arbitrary
    // role into an Aether permission. Explicit allowed IDs remain authoritative.
    return normalizeIds(ids).some(id => owned.has(id));
}
function resolveRole(member, config = {}) {
    if (!member) return 'member';
    if (member.guild?.ownerId === member.id || member.permissions?.has?.('Administrator')) return 'admin';
    if (config.allowedRoleIds?.length && !hasAllowedRole(member, config.allowedRoleIds, [])) return 'member';
    if (hasAllowedRole(member, config.adminRoleIds, config.roleOrder)) return 'admin';
    if (hasAllowedRole(member, config.startRoleIds, config.roleOrder)) return 'start';
    return 'member';
}
async function getRoleConfig(guildId) {
    const doc = await AetherRoleConfig.findOne({ guildId }).lean().catch(() => null);
    const settings = doc || {};
    const configuredAdmin = await cfg.getList(guildId, 'aether:adminRoles').catch(() => []);
    const configuredStart = await cfg.getList(guildId, 'aether:startRoles').catch(() => []);
    const guildPrefix = `AETHER_GUILD_${String(guildId).replace(/[^0-9A-Za-z_]/g, '_')}_`;
    const envAdmin = CONFIG[`${guildPrefix}ADMIN_ROLE_IDS`];
    const envStart = CONFIG[`${guildPrefix}START_ROLE_IDS`];
    const envOrder = CONFIG[`${guildPrefix}ROLE_ORDER`];
    const envAllowed = CONFIG[`${guildPrefix}ALLOWED_ROLE_IDS`];
    return {
        // A guild-specific Aether.env mapping is an explicit deployment
        // override, so stale Mongo role settings cannot lock out the league.
        adminRoleIds: normalizeIds(envAdmin || (settings.adminRoleIds?.length ? settings.adminRoleIds : (configuredAdmin.length ? configuredAdmin : CONFIG.AETHER_ADMIN_ROLE_IDS))),
        startRoleIds: normalizeIds(envStart || (settings.startRoleIds?.length ? settings.startRoleIds : (configuredStart.length ? configuredStart : CONFIG.AETHER_START_ROLE_IDS))),
        roleOrder: normalizeIds(envOrder || (settings.roleOrder?.length ? settings.roleOrder : CONFIG.AETHER_ROLE_ORDER)),
        allowedRoleIds: normalizeIds(envAllowed || (settings.allowedRoleIds?.length ? settings.allowedRoleIds : CONFIG.AETHER_ALLOWED_ROLE_IDS))
    };
}
async function setRoleConfig(guildId, patch) {
    const allowed = ['adminRoleIds', 'startRoleIds', 'roleOrder', 'allowedRoleIds'];
    const update = {};
    for (const key of allowed) if (patch[key] !== undefined) update[key] = normalizeIds(patch[key]);
    return AetherRoleConfig.findOneAndUpdate({ guildId }, { $set: update }, { upsert: true, new: true }).lean();
}
async function authorize(member, guildId, kind = 'member') {
    if (!member) return { allowed: false, role: 'member', reason: 'missing_member' };
    const c = await getRoleConfig(guildId);
    const role = resolveRole(member, c);
    const admin = role === 'admin';
    const start = role === 'start';
    const allowed = kind === 'admin'
        ? admin
        : kind === 'start'
            ? admin || start
            : kind === 'league'
                ? hasAllowedRole(member, c.allowedRoleIds)
                : true;
    return { allowed, role, reason: allowed ? null : `${kind}_role_required` };
}
async function syncSessionStatus(session) {
    if (!session) return null;
    const now = Math.floor(Date.now() / 1000);
    let status = session.status;
    if (status === 'SCHEDULED' && Number(session.startTs) <= now) status = 'ACTIVE';
    if (status === 'ACTIVE' && Number(session.endTs) <= now) status = 'ENDED';
    if (status !== session.status) {
        const completedAt = status === 'ENDED' ? new Date() : undefined;
        return AetherSession.findOneAndUpdate(
            { _id: session._id, guildId: session.guildId },
            { $set: { status, ...(completedAt ? { completedAt } : {}) } }, { new: true }
        ).lean();
    }
    return session;
}
async function getActiveSession(guildId, channelId) {
    const candidates = await AetherSession.find({
        guildId, channelId, status: { $in: ['SCHEDULED', 'ACTIVE'] }
    }).sort({ startTs: -1 }).limit(10).lean();
    for (const candidate of candidates) {
        const session = await syncSessionStatus(candidate);
        if (session?.status === 'ACTIVE') return session;
    }
    return null;
}
async function expireSanctions(Sanction, guildId) {
    if (!Sanction) return 0;
    const result = await Sanction.updateMany(
        { guildId, status: 'ACTIVE', expiresAt: { $lte: new Date() } },
        { $set: { status: 'COMPLETED' } }
    ).catch(() => ({ modifiedCount: 0 }));
    return result.modifiedCount || 0;
}
function parseLapTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const s = String(value || '').trim();
    let m = s.match(/^(\d+)m\s*(\d+(?:\.\d+)?)\s*s$/i);
    if (m) return Number(m[1]) * 6000 + parseSeconds(m[2]);
    const parts = s.split(':');
    if (parts.length === 2) return Number(parts[0]) * 6000 + parseSeconds(parts[1]);
    if (parts.length === 3) return Number(parts[0]) * 360000 + Number(parts[1]) * 6000 + parseSeconds(parts[2]);
    if (parts.length === 1 && /^\d+\.\d+\.\d+$/.test(s)) {
        const dotted = s.split('.');
        return Number(dotted[0]) * 6000 + Number(dotted[1]) * 100 + Number(dotted[2].padEnd(2, '0').slice(0, 2));
    }
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseSeconds(s);
    throw new Error(`Invalid time format: ${s}`);
}
function parseSeconds(value) {
    const [whole, fraction = ''] = String(value).split('.');
    if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) throw new Error('Invalid seconds');
    return Number(whole) * 100 + Number((fraction || '').padEnd(2, '0').slice(0, 2));
}
function formatLapTime(cs) {
    cs = Math.max(0, Math.trunc(Number(cs) || 0));
    const totalSeconds = Math.floor(cs / 100);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
function validateLapTime(cs, config = CONFIG) {
    const value = Number(cs);
    const minimum = Number(config.MIN_LAP_TIME_CS ?? 1000);
    const maximum = Number(config.MAX_LAP_TIME_CS ?? 1000000);
    if (!Number.isInteger(value) || value <= 0) throw new Error('Lap time must be a positive integer in centiseconds.');
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 1 || maximum < minimum) {
        throw new Error('Aether lap-time limits are misconfigured.');
    }
    if (value < minimum || value > maximum) {
        throw new Error(`Lap time must be between ${minimum}cs and ${maximum}cs.`);
    }
    return value;
}
function formatLeaderboard(session = {}, submissions = [], series = 'F1', options = {}) {
    const maxRounds = options.maxRounds || aetherConfig.maxRounds(series);
    const rows = submissions.filter(s => !s.series || String(s.series).toUpperCase() === String(series).toUpperCase());
    const classified = rows.filter(s => !s.sanctionDsq).sort((a, b) => (a.lapTimeCs ?? Infinity) - (b.lapTimeCs ?? Infinity) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const dsq = rows.filter(s => s.sanctionDsq);
    const type = String(session.sessionType || 'QUALIFYING').toUpperCase();
    const seriesUpper = String(series).toUpperCase();
    const seriesEmoji = session.seriesEmoji || EMOJI_FALLBACKS.series[seriesUpper] || EMOJI_FALLBACKS.series.F1;
    const lines = [`# Round ${session.roundNumber || 0}/${maxRounds}`, `# ${seriesEmoji} | ${session.raceCountry || 'Unknown'} ${session.raceFlag || ''}`, `## ${type === 'RACE' || type === 'SPRINT' ? type : 'QUALIFYING'}`, '', `<t:${Math.trunc(session.endTs || 0)}:F>`, '# ─────────────────────────────────────'];
    if (!rows.length) lines.push('(no entries yet)');
    else {
        const fastest = classified[0]?.lapTimeCs;
        for (const [i, s] of classified.slice(0, options.maxEntries || 50).entries()) {
            const gap = Number.isFinite(fastest) && Number.isFinite(s.lapTimeCs) && s.lapTimeCs > fastest ? ` **+${((s.lapTimeCs - fastest) / 100).toFixed(2)}**` : '';
            const num = Number.isFinite(Number(s.driverNumber)) ? `***${String(Math.trunc(s.driverNumber)).padStart(2, '0')}***` : '***00***';
            const teamEmoji = s.teamEmoji || EMOJI_FALLBACKS.teams[`${seriesUpper}_teams:${s.currentTeam || s.team || ''}`] || seriesEmoji;
            const tyreName = String(s.tyre || (type === 'SPRINT' && String(session.weather || 'DRY').toUpperCase() !== 'WET' ? 'hard' : 'medium')).toLowerCase();
            const tyreEmoji = s.tyreEmoji || EMOJI_FALLBACKS.tyres[tyreName] || EMOJI_FALLBACKS.tyres.medium;
            lines.push(`${String(i + 1).padStart(2, ' ')}. ${teamEmoji} | ${String(s.name || 'Unknown').toUpperCase().slice(0, 3)} ${num} | ${s.lapTimeDisplay || formatLapTime(s.lapTimeCs)}${gap} ${tyreEmoji}${s.sanctionDisplay ? ` **(${s.sanctionDisplay})**` : ''}`);
        }
        for (const s of dsq) lines.push(`DSQ. ${s.teamEmoji || ''} | ${String(s.name || 'Unknown').toUpperCase().slice(0, 3)} ***${String(Math.trunc(s.driverNumber || 0)).padStart(2, '0')}*** | DSQ`);
    }
    lines.push('# ─────────────────────────────────────');
    const result = lines.join('\n');
    return result.length > (options.messageLimit || DISCORD_MESSAGE_LIMIT)
        ? '[ERROR] Leaderboard too long to display. Use `/export` to download full results.'
        : result;
}
function generateCode() {
    return Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
}
function reductions(table = {}) {
    return Object.fromEntries(Object.keys(DEFAULT_REDUCTIONS).map(k => [k, Number.isFinite(Number(table[k])) ? Math.max(0, Number(table[k])) : DEFAULT_REDUCTIONS[k]]));
}
function invalidateGuildCaches(guildId) {
    if (!guildId) return;
    return guildId;
}

module.exports = {
    AetherRoleConfig, AetherSession, AetherProfile, AetherSubmission, AetherLicenseKey,
    AetherQualifyingResult, AetherLegacyPenalty,
    AetherEmojiConfig, AetherData,
    getConfig: aetherConfig.getConfig, reloadConfig: aetherConfig.reloadConfig,
    configList: aetherConfig.asList, maxRounds: aetherConfig.maxRounds,
    DEFAULT_REDUCTIONS, getRoleConfig, setRoleConfig, authorize, resolveRole, roleIds, roleRank,
    syncSessionStatus, getActiveSession, expireSanctions,
    upsertCentral, cleanupExpiredData, startRetentionWorker, AETHER_RETENTION_MS,
    parseLapTime, formatLapTime, validateLapTime, formatLeaderboard, generateCode, reductions, invalidateGuildCaches,
    findProfileForUser, findProfileGuildForUser
};

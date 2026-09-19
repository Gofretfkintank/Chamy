// Per-guild settings: the registry of what can be configured, and a cached
// accessor for it.
//
// Why this exists: most of the bot was written for one server, with channel,
// role and user ids written straight into the files that used them. Those ids
// are meaningless in anybody else's guild — the feature either silently does
// nothing or, worse, points at whatever happens to share that id. Each such
// constant becomes a key here, and the code asks for it by name.
//
// The contract for callers: a key that is not configured returns null (or an
// empty array for list keys). A feature whose key is unset must DO NOTHING and
// stay quiet, never fall back to an id from another server.

const GuildConfig = require('../models/GuildConfig');

// kind decides which /config subcommand sets it and how it is rendered.
// list:true keys hold an array and are edited with add/remove.
const KEYS = {
    'staff:coOwnerRole': {
        kind: 'role', label: 'Co-owner role',
        help: 'Bypasses the moderation command restrictions.'
    },
    'staff:modRoles': {
        kind: 'role', list: true, label: 'Moderator roles',
        help: 'Allowed to post race results and use staff-only commands.'
    },
    'staff:quarantineRole': {
        kind: 'role', label: 'Quarantine role',
        help: 'Applied by /quarantina; strips a member down to a holding channel.'
    },
    'staff:extraOwners': {
        kind: 'user', list: true, label: 'Extra bot owners',
        help: 'Bypass every permission check, on top of the application owner.'
    },

    'channels:log': {
        kind: 'channel', label: 'Audit log channel', legacy: 'logChannelId',
        help: 'Where the audit log is written. Also settable with /setup logs.'
    },
    'channels:announcements': {
        kind: 'channel', label: 'Announcements channel',
        help: 'Maintenance notices are posted here.'
    },
    'channels:bots': {
        kind: 'channel', label: 'Bot commands channel',
        help: 'Economy replies are kept to this channel.'
    },
    'channels:levels': {
        kind: 'channel', label: 'Level-up channel',
        help: 'Level-up messages are posted here.'
    },
    'channels:bump': {
        kind: 'channel', label: 'Bump channel',
        help: 'Where the bump reminder watches and replies.'
    },
    'channels:control': {
        kind: 'channel', label: 'Dashboard control channel',
        help: 'The owner-only dashboard lives here.'
    },
    'channels:raceTimers': {
        kind: 'channel', list: true, label: 'Race timer channels',
        help: 'Channels the race countdown is allowed to run in.'
    },
    'channels:reactionRoles': {
        kind: 'channel', label: 'Reaction-role channel',
        help: 'Where the league reaction-role message is posted.'
    },

    'roles:bumpers': {
        kind: 'role', label: 'Bumpers role',
        help: 'Pinged when the server can be bumped again.'
    },

    'categories:teamRadio': {
        kind: 'channel', label: 'Team radio category',
        help: 'Team radio voice channels are created under this category.'
    },
    'categories:paddock': {
        kind: 'channel', label: 'Paddock category',
        help: 'General chat category the assistant is allowed to talk in.'
    },

    'minecraft:statusChannel': {
        kind: 'channel', label: 'Minecraft status channel',
        help: 'Server status messages are mirrored here.'
    },
    'minecraft:statusSource': {
        kind: 'channel', label: 'Minecraft status source',
        help: 'Channel the game bridge posts raw status into.'
    },
    'minecraft:statsChannel': {
        kind: 'channel', label: 'Minecraft stats channel',
        help: 'Where the periodic stats embed is kept.'
    },

    'welcome:rulesChannel':      { kind: 'channel', label: 'Rules channel' },
    'welcome:driverRulesChannel':{ kind: 'channel', label: 'Driver rules channel' },
    'welcome:safetyRulesChannel':{ kind: 'channel', label: 'Safety car rules channel' },
    'welcome:rolesChannel':      { kind: 'channel', label: 'Role picker channel' },
    'welcome:supportChannel':    { kind: 'channel', label: 'Support channel' },

    // Not offered by /config on purpose: Ommy is woken per guild by the
    // Commander saying the phrase, not by whoever administers that server.
    'ommy:enabled': {
        kind: 'flag', internal: true, label: 'Ommy awake here',
        help: 'Set to "1" when the Commander says the wake phrase in this server.'
    }
};

const LIST_KEYS = Object.keys(KEYS).filter(k => KEYS[k].list);

// guildId -> { settings, legacy, at }
const cache = new Map();
const TTL_MS = 60_000;

function isKnown(key) {
    return Object.prototype.hasOwnProperty.call(KEYS, key);
}

function invalidate(guildId) {
    if (guildId) cache.delete(guildId);
    else cache.clear();
}

async function load(guildId) {
    const hit = cache.get(guildId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;

    let doc = null;
    try {
        doc = await GuildConfig.findOne({ guildId }).lean();
    } catch (err) {
        // Mongo hiccup: serve a stale entry rather than telling every caller the
        // guild is unconfigured, which would silently disable working features.
        if (hit) return hit;
        console.error(`[guildConfig] load failed for ${guildId}:`, err.message);
        return { settings: {}, legacy: {}, at: 0 };
    }

    const entry = {
        settings: (doc && doc.settings) || {},
        legacy  : {
            logChannelId   : doc?.logChannelId    ?? null,
            verifyRoleId   : doc?.verifyRoleId    ?? null,
            verifyChannelId: doc?.verifyChannelId ?? null
        },
        at: Date.now()
    };
    cache.set(guildId, entry);
    return entry;
}

// A single snowflake, or null when unset. Callers must handle null by doing
// nothing — never by substituting a default id.
async function get(guildId, key) {
    if (!guildId || !isKnown(key) || KEYS[key].list) return null;
    const entry = await load(guildId);
    const value = entry.settings[key];
    if (value) return String(value);
    const legacyField = KEYS[key].legacy;
    return legacyField ? (entry.legacy[legacyField] || null) : null;
}

// Always an array; empty when unset.
async function getList(guildId, key) {
    if (!guildId || !isKnown(key) || !KEYS[key].list) return [];
    const entry = await load(guildId);
    const value = entry.settings[key];
    return Array.isArray(value) ? value.map(String) : [];
}

async function set(guildId, key, value) {
    if (!isKnown(key)) throw new Error(`Unknown config key: ${key}`);
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { [`settings.${key}`]: value } },
        { upsert: true }
    );
    invalidate(guildId);
}

async function clear(guildId, key) {
    if (!isKnown(key)) throw new Error(`Unknown config key: ${key}`);
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $unset: { [`settings.${key}`]: '' } },
        { upsert: true }
    );
    invalidate(guildId);
}

async function addToList(guildId, key, value) {
    if (!isKnown(key) || !KEYS[key].list) throw new Error(`Not a list key: ${key}`);
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $addToSet: { [`settings.${key}`]: String(value) } },
        { upsert: true }
    );
    invalidate(guildId);
}

async function removeFromList(guildId, key, value) {
    if (!isKnown(key) || !KEYS[key].list) throw new Error(`Not a list key: ${key}`);
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $pull: { [`settings.${key}`]: String(value) } },
        { upsert: true }
    );
    invalidate(guildId);
}

async function all(guildId) {
    const entry = await load(guildId);
    const out = {};
    for (const key of Object.keys(KEYS)) {
        out[key] = KEYS[key].list
            ? (Array.isArray(entry.settings[key]) ? entry.settings[key].map(String) : [])
            : (entry.settings[key]
                ? String(entry.settings[key])
                : (KEYS[key].legacy ? entry.legacy[KEYS[key].legacy] || null : null));
    }
    return out;
}

// Bot-owner check, replacing the user id that was written into ~20 files.
// The application owner is authoritative; extra owners are per-guild.
async function isBotOwner(client, userId, guildId) {
    if (!userId) return false;

    const envOwners = (process.env.OWNER_IDS || process.env.COMMANDER_ID || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    if (envOwners.includes(userId)) return true;

    try {
        if (!client.application?.owner) await client.application?.fetch();
        const owner = client.application?.owner;
        if (owner) {
            // A team-owned application exposes members instead of a single user.
            if (owner.members?.has?.(userId)) return true;
            if (owner.id === userId) return true;
        }
    } catch { /* fall through to the per-guild list */ }

    if (guildId) {
        const extra = await getList(guildId, 'staff:extraOwners');
        if (extra.includes(userId)) return true;
    }
    return false;
}

module.exports = {
    KEYS, LIST_KEYS, isKnown,
    get, getList, set, clear, addToList, removeFromList, all,
    invalidate, isBotOwner
};

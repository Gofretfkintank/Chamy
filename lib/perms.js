// Who counts as "above the rules" — previously the same Discord user id typed
// into twenty different files, plus a co-owner role id that only exists in one
// server.
//
// Two different questions were being answered by that one id, and they need
// different answers now:
//
//   1. "Is this the person who runs the bot?"  → isOwner(). Global, not tied to
//      any server. Comes from OWNER_IDS so a different deployment can have a
//      different owner.
//   2. "Is this person staff HERE?"            → isGuildStaff(). Per guild, and
//      answered from that guild's own roles and permissions, never from an id
//      belonging to another server.
//
// The OWNER_IDS default below is the historical OM commander id. It is kept as
// a fallback ON PURPOSE: without it, setting no env var would silently strip
// Hasan's own bypass in his own server the moment this ships. Anyone else
// running this bot sets OWNER_IDS and never inherits it.

const { PermissionsBitField } = require('discord.js');
const cfg = require('./guildConfig');

const LEGACY_COMMANDER_ID = '1097807544849809408';

const OWNER_IDS = new Set(
    String(process.env.OWNER_IDS || process.env.COMMANDER_ID || LEGACY_COMMANDER_ID)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
);

/** The bot operator. Synchronous on purpose — most call sites are inside
 *  collector callbacks where an await would mean restructuring the caller. */
function isOwner(userId) {
    return !!userId && OWNER_IDS.has(String(userId));
}

/** Staff in THIS guild, judged by this guild's own permissions. */
function isGuildStaff(member) {
    if (!member) return false;
    return member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
           member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/**
 * Whoever started a game can drive it; so can the bot operator, for support.
 * Deliberately NOT extended to all staff: a moderator hijacking someone's
 * running game is a behaviour change nobody asked for.
 */
function canControlGame(interaction, hostId) {
    const userId = interaction?.user?.id;
    if (!userId) return false;
    return userId === hostId || isOwner(userId);
}

/**
 * The elevated tier the moderation commands use: bot operator, server owner,
 * or the co-owner role THIS guild configured. Async because the role id comes
 * from that guild's config rather than from a constant.
 */
async function hasFullPower(member) {
    if (!member) return false;
    if (isOwner(member.id)) return true;
    if (member.guild?.ownerId === member.id) return true;
    const coOwnerRole = await cfg.get(member.guild?.id, 'staff:coOwnerRole');
    return !!coOwnerRole && member.roles.cache.has(coOwnerRole);
}

/** Moderator roles this guild configured, on top of Discord permissions. */
async function isModerator(member) {
    if (!member) return false;
    if (isGuildStaff(member)) return true;
    if (await hasFullPower(member)) return true;
    const modRoles = await cfg.getList(member.guild?.id, 'staff:modRoles');
    return modRoles.some(id => member.roles.cache.has(id));
}

module.exports = {
    OWNER_IDS, isOwner, isGuildStaff, canControlGame, hasFullPower, isModerator
};

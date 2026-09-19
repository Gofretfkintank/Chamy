const mongoose = require('mongoose');

// One document per guild — general-purpose per-server bot settings.
//
// The three named fields below are the original ones and are kept so that
// existing documents and /setup keep working untouched. Everything added since
// lives in `settings`, a free-form map, so a new configurable value costs a line
// in lib/guildConfig.js instead of a schema migration.
//
// Map keys use ':' as their separator, never '.', because dots are not safe as
// Mongo field names.
const guildConfigSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true
    },
    logChannelId: {
        type: String,
        default: null
    },
    verifyRoleId: {
        type: String,
        default: null
    },
    verifyChannelId: {
        type: String,
        default: null
    },

    // key -> snowflake string, or array of snowflake strings for list keys.
    settings: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: () => new Map()
    }
});

module.exports = mongoose.model('GuildConfig', guildConfigSchema);

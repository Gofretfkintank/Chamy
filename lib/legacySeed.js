// One-time seed of the OM server's existing configuration.
//
// Every hardcoded channel/role id in this bot used to be a constant that only
// made sense in one server. Moving them into per-guild config is what makes the
// bot usable anywhere — but it would also mean that, on the deploy that ships
// it, Hasan's own server suddenly has nothing configured and half the features
// go quiet. This writes the historical values into that guild's config on the
// first boot after the change, so nothing there changes at all.
//
// It runs once (guarded by a marker key), never overwrites a value somebody
// already set, and does nothing in any other server.

const cfg = require('./guildConfig');
const GuildConfig = require('../models/GuildConfig');

const LEGACY_GUILD_ID = process.env.LEGACY_GUILD_ID || '1446960659072946218';
const MARKER = 'migrated:legacyIds';

// The ids as they were written in the source, with the file they came from.
const LEGACY_VALUES = {
    'staff:coOwnerRole'         : '1447144645489328199', // index.js, ban.js, kick.js, ommy.js
    'staff:quarantineRole'      : '1487415507031167176', // quarantina.js
    'staff:modRoles'            : ['1447143999902187580', '1447143381569376327'], // results.js

    'channels:announcements'    : '1447146110689742951', // maintenance.js
    'channels:bots'             : '1452733309724393664', // economyListener.js
    'channels:levels'           : '1452948024299884670', // economyListener.js
    'channels:bump'             : '1500791833012338901', // bumpReminder.js
    'channels:control'          : '1488543017794142309', // dashboard.js
    'channels:reactionRoles'    : '1523322501738922054', // data/reactionRoles.js
    'channels:raceTimers'       : [                      // raceTimer.js
        '1452925248973443072', '1452925110037118986', '1453103992514019499',
        '1480929264693018734', '1475519196367421503', '1496136966067060777'
    ],

    'roles:bumpers'             : '1500811475713916958', // bumpReminder.js

    'categories:teamRadio'      : '1492527809971748934', // teamradio.js
    'categories:paddock'        : '1447142057385918546', // ommy.js

    'minecraft:statusChannel'   : '1511995662865141810', // mcturn.js, serverStatus.js
    'minecraft:statusSource'    : '1512291789644628088', // serverStatus.js
    'minecraft:statsChannel'    : '1512863852176474132', // mcStats.js

    'welcome:rulesChannel'      : '1447147256347365537', // welcomeDM.js
    'welcome:driverRulesChannel': '1447147377394843719',
    'welcome:safetyRulesChannel': '1447147511574822972',
    'welcome:rolesChannel'      : '1452713858027487384',
    'welcome:supportChannel'    : '1489488289533526178'
};

async function seedLegacyGuild() {
    if (!LEGACY_GUILD_ID) return;

    let doc;
    try {
        doc = await GuildConfig.findOne({ guildId: LEGACY_GUILD_ID }).lean();
    } catch (err) {
        console.error('[legacySeed] Could not read GuildConfig:', err.message);
        return;
    }

    const existing = (doc && doc.settings) || {};
    if (existing[MARKER]) return; // already done

    const toWrite = {};
    for (const [key, value] of Object.entries(LEGACY_VALUES)) {
        // Never clobber something that was set by hand in the meantime.
        const current = existing[key];
        const isEmpty = Array.isArray(current) ? current.length === 0 : !current;
        if (isEmpty) toWrite[`settings.${key}`] = value;
    }
    toWrite[`settings.${MARKER}`] = new Date().toISOString();

    try {
        await GuildConfig.findOneAndUpdate(
            { guildId: LEGACY_GUILD_ID },
            { $set: toWrite },
            { upsert: true }
        );
        cfg.invalidate(LEGACY_GUILD_ID);
        const written = Object.keys(toWrite).length - 1;
        console.log(`[legacySeed] Seeded ${written} setting(s) for guild ${LEGACY_GUILD_ID}.`);
    } catch (err) {
        console.error('[legacySeed] Seed failed:', err.message);
    }
}

module.exports = { seedLegacyGuild, LEGACY_GUILD_ID, LEGACY_VALUES };

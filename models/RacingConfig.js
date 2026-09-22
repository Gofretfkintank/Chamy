const mongoose = require('mongoose');

// Per-guild qualifying-to-race time reduction table, in centiseconds, keyed by
// finishing position ("1".. "10"). A league that ranks worse than P10 in
// qualifying gets no reduction, same as Aether's rule this is modeled on.
//
// A guild with no document yet (or missing a specific position) falls back to
// the defaults in events/ommy.js (DEFAULT_QUALIFYING_REDUCTIONS_CS) rather
// than to another guild's numbers.
const racingConfigSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true
    },
    qualifyingReductionsCs: {
        type: Map,
        of: Number,
        default: () => new Map()
    }
});

module.exports = mongoose.model('RacingConfig', racingConfigSchema);

const mongoose = require('mongoose');

// A sporting penalty issued to a driver — mirrors Aether's sanctions table:
// exactly two kinds, TIME (a centisecond penalty added to a session/round
// result) or DSQ (disqualification, no time value). Per guild, so leagues on
// different servers never see each other's penalties.
const sanctionSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        index: true
    },
    // Short human-readable code (e.g. "K7QM"), shown to staff instead of the
    // Mongo _id, and how a penalty is looked up to remove it later.
    sanctionCode: {
        type: String,
        required: true
    },
    targetUserId: {
        type: String,
        required: true,
        index: true
    },
    targetTag: {
        type: String,
        default: ''
    },
    sanctionType: {
        type: String,
        enum: ['TIME', 'DSQ'],
        required: true
    },
    // Centiseconds; required for TIME, absent for DSQ.
    penaltyCs: {
        type: Number,
        default: null
    },
    // Freeform: round number, session name, track — whatever the league uses
    // to identify what this penalty applies to. Not a foreign key to a
    // session table, since Chamy has no session/submission system.
    context: {
        type: String,
        default: ''
    },
    reason: {
        type: String,
        default: ''
    },
    createdBy: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    expirationDays: {
        type: Number,
        default: 1,
        min: 1,
        max: 3650
    },
    expiresAt: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'COMPLETED', 'REMOVED'],
        default: 'ACTIVE'
    },
    removedBy: {
        type: String,
        default: null
    },
    removedAt: {
        type: Date,
        default: null
    }
});

sanctionSchema.index({ guildId: 1, sanctionCode: 1 }, { unique: true });

module.exports = mongoose.model('Sanction', sanctionSchema);

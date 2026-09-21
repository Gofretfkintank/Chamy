//--------------------------------
// MODEL
//--------------------------------
const mongoose = require('mongoose');

const bumpReminderSchema = new mongoose.Schema({
    // 'carl' or 'disboard'
    type: { type: String, required: true },

    // Which server the bump happened in. Reminders written before the bot
    // served more than one guild have none, and are treated as the home guild's.
    guildId: { type: String, default: null },

    // For carl: the user who bumped (reminded individually)
    userId: { type: String, default: null },

    // Unix timestamp (ms) when the reminder should fire
    remindAt: { type: Number, required: true },

    // Whether the reminder has already fired
    notified: { type: Boolean, default: false }
});

module.exports = mongoose.model('BumpReminder', bumpReminderSchema);

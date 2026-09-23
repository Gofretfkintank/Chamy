// models/ResultCursor.js -- sonuc kanali basina "en son hangi mesaji okudum".
const { Schema, model } = require('mongoose');

module.exports = model('ResultCursor', new Schema({
    channelId:     { type: String, required: true, unique: true },
    guildId:       { type: String, default: '' },
    lastMessageId: { type: String, default: null },
    scannedAt:     { type: Date, default: null },
}));

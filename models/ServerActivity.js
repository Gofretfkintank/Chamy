// models/ServerActivity.js
// Pasif aktivite sayaçları — events/serverPulse.js yazar, AI kullanılmaz.
// Doküman başına: (sunucu, hafta, kullanıcı). userId '__guild__' olan doküman
// o haftanın sunucu geneli saat (UTC) ve gün histogramını tutar.
// expiresAt ile ~9 hafta sonra Mongo kendisi siler.

const { Schema, model } = require('mongoose');

const serverActivitySchema = new Schema({
    guildId:     { type: String, required: true },
    week:        { type: Number, required: true },   // Math.floor(epochMs / WEEK_MS)
    userId:      { type: String, required: true },
    name:        { type: String, default: '' },
    count:       { type: Number, default: 0 },
    raceTalk:    { type: Number, default: 0 },       // yarış/lobi kanallarındaki mesajlar
    hostSignals: { type: Number, default: 0 },       // "lobby / oda kodu / hostluyorum" gibi mesajlar
    hours:       { type: Schema.Types.Mixed, default: {} }, // { "0".."23": n }  (sadece __guild__)
    days:        { type: Schema.Types.Mixed, default: {} }, // { "0".."6": n }   (sadece __guild__, 0=Pazar)
    lastAt:      { type: Date },
    expiresAt:   { type: Date },
});

serverActivitySchema.index({ guildId: 1, week: 1, userId: 1 }, { unique: true });
serverActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('ServerActivity', serverActivitySchema);

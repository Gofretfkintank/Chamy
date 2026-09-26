// models/TrustProfile.js
// Chamy trust skoru icin kullanici basina (sunucu basina) etkilesim ozeti.
// Mesaj ICERIGI saklanmaz; sadece sayilar ve kiminle etkilesim kurdugu.

const mongoose = require('mongoose');

const ToneFlagSchema = new mongoose.Schema({
    at:   { type: Date, default: Date.now },
    type: { type: String },          // 'recon' | 'hostile'
    note: { type: String, default: '' }, // Gemma'nin kisa gerekcesi (<= ~120 karakter)
}, { _id: false });

const TrustProfileSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId:  { type: String, required: true },

    messages: { type: Number, default: 0 },
    days:     { type: [String], default: [] },          // son ~60 aktif gun (YYYY-MM-DD)
    partners: { type: Map, of: Number, default: {} },   // etkilesim kurdugu kisi -> skor
    modInteractions:   { type: Number, default: 0 },    // modlarla karsilikli etkilesim
    reactionsReceived: { type: Number, default: 0 },

    toneFlags: { type: [ToneFlagSchema], default: [] }, // son 10 Gemma bayragi
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'trust_profiles' });

TrustProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.TrustProfile
    || mongoose.model('TrustProfile', TrustProfileSchema);

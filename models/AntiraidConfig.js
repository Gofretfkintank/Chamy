// models/AntiraidConfig.js
// Chamy antiraid — sunucu basina ayar. Varsayilan KAPALI: bir sunucunun yetkilisi
// /antiraid on demeden Chamy o sunucuda kimseyi banlamaz.

const mongoose = require('mongoose');

const AntiraidConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },

    // Katilim dalgasi (join raid) esikleri.
    joinWindowMs:  { type: Number, default: 10_000 }, // bu pencerede...
    joinThreshold: { type: Number, default: 6 },       // ...bu kadar yeni hesap = raid
    // Genc hesap = suphe. Bu yastan kucuk hesaplar dalgada daha agir sayilir.
    minAccountAgeMs: { type: Number, default: 7 * 24 * 60 * 60 * 1000 }, // 7 gun

    // Nuke (kanal/rol silme, toplu ban) esikleri — tek yetkili, kisa pencere.
    nukeWindowMs:  { type: Number, default: 10_000 },
    nukeThreshold: { type: Number, default: 4 },

    // Beyaz liste: bu roldekiler ve bu kullanicilar hicbir zaman aksiyona ugramaz.
    whitelistUserIds: { type: [String], default: [] },
    whitelistRoleIds: { type: [String], default: [] },

    // Bildirim / kayit kanali (opsiyonel). Bos ise sadece konsola log.
    alertChannelId: { type: String, default: null },

    // Gunluk Gemma ton taramasi (mesaj icerigi Google'a gider -> ayrica acilir).
    toneScan: { type: Boolean, default: false },
    // channelId -> son taranan mesaj id'si (sadece yeni mesajlar okunsun).
    toneCursors: { type: Map, of: String, default: {} },

    // Lockdown durumu (raid sirasinda restart olursa kaldigi yerden devam).
    lockdownUntil: { type: Date, default: null },
    lockdownPrevLevel: { type: Number, default: null },
    lockdownInvitesWerePaused: { type: Boolean, default: null },

    updatedAt: { type: Date, default: Date.now },
}, { collection: 'antiraid_configs' });

module.exports = mongoose.models.AntiraidConfig
    || mongoose.model('AntiraidConfig', AntiraidConfigSchema);

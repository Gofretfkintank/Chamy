// models/GlobalBan.js
// Kesin raid botu / raid sahibi hesaplar. Chamy'nin oldugu HER acik-korumali
// sunucuda bu hesaplar girer girmez atilir (soru sorulmaz). Buraya sadece
// otomatik yakalanip birden fazla sunucuda raide karisan ya da elle Gofret'in
// eklediği hesaplar girer -- yanlis pozitifi dusuk tutmak icin esik yuksek.

const mongoose = require('mongoose');

const GlobalBanSchema = new mongoose.Schema({
    userId:   { type: String, required: true, unique: true, index: true },
    reason:   { type: String, default: 'Raid activity' },
    // Kac ayri sunucuda raide karisti (otomatik yukselir; esik gecince global olur).
    hitGuilds: { type: [String], default: [] },
    addedBy:  { type: String, default: 'auto' }, // 'auto' | Gofret'in id'si
    createdAt: { type: Date, default: Date.now },
}, { collection: 'antiraid_globalbans' });

module.exports = mongoose.models.GlobalBan
    || mongoose.model('GlobalBan', GlobalBanSchema);

// models/MadcarLink.js
// Madcar hesap ID'si <-> Discord hesabi. Mad+ kullanicisi yaris raporu
// yolladiginda kendi satiri (local) uzerinden otomatik kurulur -- ayni kisi
// public odada Madcar ID'siyle, ligde Discord'uyla ayni rating'de toplanir.

const { Schema, model } = require('mongoose');

module.exports = model('MadcarLink', new Schema({
    madcarId:  { type: String, required: true, unique: true },
    discordId: { type: String, required: true, index: true },
    nick:      { type: String, default: '' },
}, { timestamps: true }));

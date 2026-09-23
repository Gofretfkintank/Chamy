// models/TrackRecord.js
// Madcar dunya rekorlari -- pist basina, sinif basina (2004, 1991, 1975, 2021,
// Hypercar, GT3, 992...). /wr sync bir WR kanalini tarayip buraya yazar.
// game: 'madcar' | 'madcar-ultimate' (M25 kanalinda ayri bolum).
// madplusTrackId: Mad+ uygulamasindaki pist id'si (eslesmezse null).

const { Schema, model } = require('mongoose');

const recordSchema = new Schema({
    carClass:   { type: String, default: '' },
    note:       { type: String, default: '' },   // "bugged" gibi
    holderId:   { type: String, default: null },
    holderName: { type: String, default: '' },
    time:       { type: String, default: '' },   // "1:18.82" / "38.54"
    timeMs:     { type: Number, default: 0 },
}, { _id: false });

const trackRecordSchema = new Schema({
    game:            { type: String, default: 'madcar' },
    trackKey:        { type: String, required: true },
    trackName:       { type: String, default: '' },
    madplusTrackId:  { type: String, default: null },
    records:         { type: [recordSchema], default: [] },
    sourceGuildId:   { type: String, default: '' },
    sourceChannelId: { type: String, default: '' },
    sourceMessageId: { type: String, default: '' },
    sourceAt:        { type: Date,   default: null },
    syncedAt:        { type: Date,   default: null },
});

trackRecordSchema.index({ game: 1, trackKey: 1 }, { unique: true });

module.exports = model('TrackRecord', trackRecordSchema);

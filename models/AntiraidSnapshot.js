// models/AntiraidSnapshot.js
// Sunucu yapisinin (kanallar + roller) anlik goruntusu. Nuke sonrasi Chamy
// bununla server'i geri kurar (Ommy-Antiraid'deki restore mantiginin aynisi).

const mongoose = require('mongoose');

const OverwriteSchema = new mongoose.Schema({
    id:    String,
    type:  Number,
    allow: String,
    deny:  String,
}, { _id: false });

const ChannelSchema = new mongoose.Schema({
    id:       String,
    name:     String,
    type:     Number,
    parentId: { type: String, default: null },
    position: Number,
    topic:    { type: String, default: null },
    permissionOverwrites: { type: [OverwriteSchema], default: [] },
}, { _id: false });

const RoleSchema = new mongoose.Schema({
    id:          String,
    name:        String,
    color:       Number,
    permissions: String,
    hoist:       Boolean,
    mentionable: Boolean,
    position:    Number,
}, { _id: false });

const AntiraidSnapshotSchema = new mongoose.Schema({
    guildId:    { type: String, required: true, index: true },
    label:      { type: String, default: 'auto' },
    serverName: String,
    serverIcon: { type: String, default: null },
    channels:   { type: [ChannelSchema], default: [] },
    roles:      { type: [RoleSchema], default: [] },
    createdAt:  { type: Date, default: Date.now },
}, { collection: 'antiraid_snapshots' });

// Sunucu basina en fazla ~10 snapshot tut; eskiyi TTL yerine elle budariz.
module.exports = mongoose.models.AntiraidSnapshot
    || mongoose.model('AntiraidSnapshot', AntiraidSnapshotSchema);

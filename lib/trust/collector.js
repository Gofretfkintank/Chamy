// lib/trust/collector.js
// Etkilesim sayaci. Her mesaj/tepki geldiginde BELLEKTE biriktirir, dakikada bir
// Mongo'ya toplu yazar (bulkWrite). Hot path'te hic veritabani cagrisi yok.
//
// Samimiyet sinyalleri (icerige bakmadan):
//   - cevap (reply)      : iki yonlu, agirlik 2
//   - etiket (mention)   : iki yonlu, agirlik 1
//   - tepki (reaction)   : iki yonlu, agirlik 1
//   - karsi taraf mod ise modInteractions artar

const { PermissionsBitField } = require('discord.js');
const TrustProfile = require('../../models/TrustProfile');

const pending = new Map(); // `${guildId}:${userId}` -> accumulator

function today() {
    return new Date().toISOString().slice(0, 10);
}

function acc(guildId, userId) {
    const key = `${guildId}:${userId}`;
    let a = pending.get(key);
    if (!a) {
        a = { guildId, userId, messages: 0, day: null, partners: new Map(), mod: 0, reactRecv: 0 };
        pending.set(key, a);
    }
    return a;
}

function isMod(member) {
    return !!member?.permissions?.has(PermissionsBitField.Flags.ManageMessages);
}

function link(guild, fromId, toId, weight) {
    if (!toId || toId === fromId) return;
    const a = acc(guild.id, fromId);
    const b = acc(guild.id, toId);
    a.partners.set(toId, (a.partners.get(toId) || 0) + weight);
    b.partners.set(fromId, (b.partners.get(fromId) || 0) + weight);
    if (isMod(guild.members.cache.get(toId))) a.mod++;
    if (isMod(guild.members.cache.get(fromId))) b.mod++;
}

function recordMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const a = acc(message.guild.id, message.author.id);
    a.messages++;
    a.day = today();

    const replied = message.mentions?.repliedUser;
    if (replied && !replied.bot) link(message.guild, message.author.id, replied.id, 2);

    let n = 0;
    for (const u of message.mentions?.users?.values?.() || []) {
        if (u.bot || u.id === replied?.id) continue;
        link(message.guild, message.author.id, u.id, 1);
        if (++n >= 5) break; // toplu etiket skoru sisirmesin
    }
}

function recordReaction(reaction, user) {
    const msg = reaction.message;
    if (!msg?.guild || user?.bot) return;
    const author = msg.author;
    if (!author || author.bot || author.id === user.id) return; // partial mesajlari atla
    acc(msg.guild.id, author.id).reactRecv++;
    link(msg.guild, user.id, author.id, 1);
}

async function flush() {
    if (!pending.size) return;
    const batch = [...pending.values()];
    pending.clear();

    const ops = batch.map(a => {
        const inc = { messages: a.messages, modInteractions: a.mod, reactionsReceived: a.reactRecv };
        for (const [pid, w] of a.partners) inc[`partners.${pid}`] = w;
        const update = { $inc: inc, $set: { updatedAt: new Date() } };
        if (a.day) update.$addToSet = { days: a.day };
        return {
            updateOne: {
                filter: { guildId: a.guildId, userId: a.userId },
                update,
                upsert: true,
            },
        };
    });

    try {
        await TrustProfile.bulkWrite(ops, { ordered: false });
    } catch (err) {
        console.error('[TRUST] flush failed:', err.message);
    }
}

// Gunluk budama: sadece son 60 aktif gun kalsin.
async function trimDays() {
    try {
        await TrustProfile.updateMany(
            { 'days.60': { $exists: true } },
            [{ $set: { days: { $slice: ['$days', -60] } } }],
        );
    } catch (err) {
        console.error('[TRUST] trim failed:', err.message);
    }
}

module.exports = { recordMessage, recordReaction, flush, trimDays };

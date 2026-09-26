// lib/trust/score.js
// 0-100 guven skoru. Buyuk kismi ucretsiz etkilesim verisinden gelir; Gemma'nin
// ton bayraklari sadece ceza olarak eklenir. Skor TEK BASINA kimseyi banlamaz;
// antiraid'in ne kadar sert davranacagini ayarlar ve modlara bilgi verir.

const { PermissionsBitField } = require('discord.js');
const TrustProfile = require('../../models/TrustProfile');

const DAY = 24 * 60 * 60 * 1000;
const FLAG_TTL = 30 * DAY;

const cache = new Map(); // `${guildId}:${userId}` -> { at, result }
const TTL_MS = 5 * 60 * 1000;

const clamp01 = x => Math.max(0, Math.min(1, x));

function compute(member, profile) {
    const now = Date.now();
    const parts = {};

    const tenureDays = member.joinedTimestamp ? (now - member.joinedTimestamp) / DAY : 0;
    const accountDays = (now - member.user.createdTimestamp) / DAY;
    parts.tenure  = 25 * clamp01(tenureDays / 90);   // 3 ayda tam
    parts.account = 10 * clamp01(accountDays / 180); // 6 ayda tam

    const p = profile || {};
    const msgs = p.messages || 0;
    const activeDays = (p.days || []).length;
    parts.activity    = 15 * clamp01(Math.log10(msgs + 1) / 3); // ~1000 mesajda tam
    parts.consistency = 10 * clamp01(activeDays / 30);          // 30 aktif gunde tam

    const partnerCount = p.partners
        ? (p.partners instanceof Map ? p.partners.size : Object.keys(p.partners).length)
        : 0;
    parts.social    = 20 * clamp01(partnerCount / 15);                        // 15 kisiyle etkilesim
    parts.modBond   = 10 * clamp01((p.modInteractions || 0) / 20);
    parts.reactions = 10 * clamp01(Math.log10((p.reactionsReceived || 0) + 1) / 2);

    // Gemma bayraklari (son 30 gun).
    const recent = (p.toneFlags || []).filter(f => now - new Date(f.at).getTime() < FLAG_TTL);
    const recon = recent.filter(f => f.type === 'recon').length;
    const hostile = recent.filter(f => f.type === 'hostile').length;
    parts.penalty = -Math.min(40, recon * 20) - Math.min(20, hostile * 10);

    const score = Math.round(Math.max(0, Math.min(100,
        Object.values(parts).reduce((s, v) => s + v, 0))));
    return { score, parts, flags: recent };
}

async function trustOf(member) {
    if (!member) return { score: 0, parts: {}, flags: [] };
    if (member.id === member.guild.ownerId ||
        member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return { score: 100, parts: { staff: 100 }, flags: [] };
    }
    const key = `${member.guild.id}:${member.id}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

    const profile = await TrustProfile.findOne({ guildId: member.guild.id, userId: member.id })
        .lean().catch(() => null);
    const result = compute(member, profile);
    cache.set(key, { at: Date.now(), result });
    return result;
}

function invalidate(guildId, userId) {
    cache.delete(`${guildId}:${userId}`);
}

module.exports = { trustOf, compute, invalidate };

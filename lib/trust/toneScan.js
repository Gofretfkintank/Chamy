// lib/trust/toneScan.js
// Gunluk Gemma ton taramasi. Sadece /antiraid tonescan ile ACIK sunucularda.
//
// Maliyeti dusuk tutmak icin:
//   - Her kanalda sadece SON TARAMADAN BERI gelen mesajlar okunur (kanal basina en
//     fazla 300). Ilk calismada sadece son 100 mesaj.
//   - Bot mesajlari ve cok kisa mesajlar atlanir.
//   - Kullanicilar takma adla gider (u1, u2...): Google'a isim/ID gitmez.
//   - Kanallar sirayla, aralarda bekleyerek islenir (Gemma dakikalik limit).
//
// Gemma SADECE iki seyi isaretler: raid kesfi (recon) ve hedefli taciz (hostile).
// Moderatorleri elestirmek, troll, sakalasma, konu disi sohbet ISARETLENMEZ.

const { ChannelType, PermissionsBitField } = require('discord.js');
const gemma = require('../gemma');
const AntiraidConfig = require('../../models/AntiraidConfig');
const TrustProfile = require('../../models/TrustProfile');
const configStore = require('../antiraid/configStore');
const { invalidate: invalidateScore } = require('./score');

const PER_CHANNEL = 300;
const FIRST_RUN = 100;
const CHUNK_LINES = 120;
const MIN_CHARS = 8;
const MAX_MSG_CHARS = 300;
const PAUSE_MS = 4000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SYSTEM = `You review a Discord chat log for a community's safety system.
Users are pseudonyms (u1, u2, ...). "(mod)" marks moderators.

Flag a user ONLY for one of these:
- "recon": looks like preparation for a raid or server takeover: asking who has admin / ban / manage permissions, asking when moderators or the owner are offline or asleep, probing how the bots, verification or roles are set up, asking for permissions they have no reason to need, recruiting people or sharing plans to raid or "attack" this server.
- "hostile": sustained, targeted harassment, threats or doxxing aimed at a member or moderator.

Do NOT flag: criticism of moderators or rules, complaints, jokes, banter between friends, trolling or copypasta, memes, off-topic chat, swearing, normal arguments. If unsure, do NOT flag.

Reply with ONLY JSON, no prose:
{"flags":[{"user":"u3","type":"recon","note":"max 15 words: why"}]}
Use {"flags":[]} when nothing qualifies.`;

function readable(channel, me) {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return false;
    const p = channel.permissionsFor(me);
    return p?.has(PermissionsBitField.Flags.ViewChannel) && p?.has(PermissionsBitField.Flags.ReadMessageHistory);
}

async function fetchNew(channel, afterId) {
    const out = [];
    if (!afterId) {
        const batch = await channel.messages.fetch({ limit: FIRST_RUN }).catch(() => null);
        return batch ? [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
    }
    let after = afterId;
    while (out.length < PER_CHANNEL) {
        const batch = await channel.messages.fetch({ limit: 100, after }).catch(() => null);
        if (!batch?.size) break;
        const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        out.push(...sorted);
        after = sorted[sorted.length - 1].id;
        if (batch.size < 100) break;
    }
    return out.slice(0, PER_CHANNEL);
}

function parseFlags(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
        const obj = JSON.parse(m[0]);
        return Array.isArray(obj.flags) ? obj.flags : [];
    } catch {
        return [];
    }
}

async function scanChannel(guild, channel, afterId) {
    const msgs = await fetchNew(channel, afterId);
    if (!msgs.length) return { lastId: afterId, flagged: 0 };
    const lastId = msgs[msgs.length - 1].id;

    // Takma adlar.
    const alias = new Map(); // userId -> 'uN'
    const back = new Map();  // 'uN' -> userId
    const lines = [];
    for (const m of msgs) {
        if (m.author?.bot || m.webhookId) continue;
        const text = (m.content || '').replace(/\s+/g, ' ').trim();
        if (text.length < MIN_CHARS) continue;
        if (!alias.has(m.author.id)) {
            const a = `u${alias.size + 1}`;
            alias.set(m.author.id, a);
            back.set(a, m.author.id);
        }
        const mod = m.member?.permissions?.has(PermissionsBitField.Flags.ManageMessages) ? ' (mod)' : '';
        // Mesaj icindeki etiketleri de takma ada cevir.
        const safe = text.replace(/<@!?(\d+)>/g, (_, id) => alias.get(id) || '@user').slice(0, MAX_MSG_CHARS);
        lines.push(`${alias.get(m.author.id)}${mod}: ${safe}`);
    }
    if (lines.length < 5) return { lastId, flagged: 0 };

    let flagged = 0;
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        const chunk = lines.slice(i, i + CHUNK_LINES).join('\n');
        let flags = [];
        try {
            const reply = await gemma.generate(
                SYSTEM,
                `Server: ${guild.name}\nChannel: #${channel.name}\n\n${chunk}`,
                [], 512,
            );
            flags = parseFlags(reply);
        } catch (err) {
            console.error(`[TRUST] gemma failed in #${channel.name}:`, err.message);
            continue;
        }
        for (const f of flags) {
            const userId = back.get(String(f.user || '').trim());
            if (!userId) continue;
            if (!['recon', 'hostile'].includes(f.type)) continue;
            const member = guild.members.cache.get(userId);
            if (member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) continue; // mod'a bayrak yok
            await TrustProfile.updateOne(
                { guildId: guild.id, userId },
                { $push: { toneFlags: { $each: [{ at: new Date(), type: f.type, note: String(f.note || '').slice(0, 120) }], $slice: -10 } } },
                { upsert: true },
            ).catch(() => {});
            invalidateScore(guild.id, userId);
            flagged++;
        }
        await sleep(PAUSE_MS);
    }
    return { lastId, flagged };
}

async function runToneScan(client) {
    for (const guild of client.guilds.cache.values()) {
        let cfg;
        try { cfg = await configStore.get(guild.id); } catch { continue; }
        if (!cfg.enabled || !cfg.toneScan) continue;

        const cursors = cfg.toneCursors || {};
        const me = guild.members.me;
        let total = 0;
        for (const channel of guild.channels.cache.values()) {
            if (!readable(channel, me)) continue;
            try {
                const { lastId, flagged } = await scanChannel(guild, channel, cursors[channel.id]);
                total += flagged;
                if (lastId && lastId !== cursors[channel.id]) {
                    await AntiraidConfig.updateOne(
                        { guildId: guild.id },
                        { $set: { [`toneCursors.${channel.id}`]: lastId } },
                    ).catch(() => {});
                }
            } catch (err) {
                console.error(`[TRUST] scan #${channel.name} failed:`, err.message);
            }
            await sleep(PAUSE_MS);
        }
        configStore.invalidate(guild.id);
        console.log(`[TRUST] tone scan done for ${guild.name}: ${total} flag(s)`);
    }
}

module.exports = { runToneScan };

// lib/antiraid/guards.js
// Silme disindaki ele gecirme yollari:
//   - @everyone'a / genis bir role tehlikeli yetki verme (Administrator, Ban, ...)
//     -> TEK olayda aninda geri al + yapanin rollerini al. Hic mesru degildir.
//   - Kanalda @everyone'a tehlikeli izin acma -> geri al + nuke sayacina ekle.
//   - Birine tehlikeli rol verme -> nuke sayacina ekle; hedef bot/yeni hesapsa rolu geri al.
//   - Sunucuya bot eklenmesi -> modlara bildir.
//   - Webhook spami -> webhook'u sil + mesajlari temizle.

const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const configStore = require('./configStore');
const { sendAlert } = require('./alert');
const { stripActor } = require('./actions');
const engine = require('./engine');

const F = PermissionsBitField.Flags;
const DANGEROUS = F.Administrator | F.ManageGuild | F.ManageRoles | F.ManageChannels |
    F.BanMembers | F.KickMembers | F.ManageWebhooks | F.MentionEveryone | F.ModerateMembers;
const WEEK = 7 * 24 * 60 * 60 * 1000;

function gained(oldBits, newBits) {
    const o = BigInt(oldBits ?? 0);
    const n = BigInt(newBits ?? 0);
    return (n & ~o) & DANGEROUS;
}

function names(bits) {
    return new PermissionsBitField(bits).toArray().join(', ');
}

async function exempt(guild, cfg, actorId) {
    if (!actorId) return true;
    if (actorId === guild.client.user.id) return true;
    if (actorId === guild.ownerId) return true;
    return configStore.isWhitelisted(cfg, actorId);
}

async function onAuditEntry(entry, guild) {
    const cfg = await configStore.get(guild.id);
    if (!cfg.enabled) return;
    const actorId = entry.executorId;

    switch (entry.action) {
        case AuditLogEvent.RoleUpdate: {
            if (await exempt(guild, cfg, actorId)) return;
            const ch = entry.changes?.find(c => c.key === 'permissions');
            if (!ch) return;
            const g = gained(ch.old, ch.new);
            if (!g) return;
            const role = guild.roles.cache.get(entry.targetId);
            if (!role) return;
            const wide = role.id === guild.id || role.members.size >= Math.max(10, guild.memberCount * 0.2);
            if (!wide) {
                await engine.onDestructiveAction(guild, actorId, 'dangerous role permission');
                return;
            }
            // @everyone ya da cok kisinin tasidigi rol: aninda geri al.
            const reason = `[Chamy Antiraid] Reverted dangerous permissions on ${role.name}`;
            await Promise.all([
                role.setPermissions(BigInt(ch.old ?? 0), reason).catch(() => {}),
                stripActor(guild, actorId, reason),
            ]);
            await sendAlert(guild, cfg, {
                title: '🛑 Permission takeover blocked',
                lines: [
                    `<@${actorId}> gave **${names(g)}** to ${role.id === guild.id ? '@everyone' : `**${role.name}** (${role.members.size} members)`}.`,
                    'Change reverted, their roles stripped and timed out for 1h.',
                ],
            });
            return;
        }

        case AuditLogEvent.ChannelOverwriteCreate:
        case AuditLogEvent.ChannelOverwriteUpdate: {
            if (await exempt(guild, cfg, actorId)) return;
            if (entry.extra?.id !== guild.id) return; // sadece @everyone overwrite'i
            const ch = entry.changes?.find(c => c.key === 'allow');
            if (!ch) return;
            const g = gained(ch.old, ch.new);
            if (!g) return;
            const channel = guild.channels.cache.get(entry.targetId);
            const ow = channel?.permissionOverwrites?.cache.get(guild.id);
            if (ow) {
                const undo = {};
                for (const name of new PermissionsBitField(g).toArray()) undo[name] = null;
                await ow.edit(undo, '[Chamy Antiraid] Reverted dangerous @everyone permission').catch(() => {});
            }
            await engine.onDestructiveAction(guild, actorId, 'dangerous channel permission');
            await sendAlert(guild, cfg, {
                title: '🛑 Channel permission reverted',
                lines: [`<@${actorId}> opened **${names(g)}** to @everyone in <#${entry.targetId}>. Reverted.`],
            });
            return;
        }

        case AuditLogEvent.MemberRoleUpdate: {
            if (await exempt(guild, cfg, actorId)) return;
            const added = entry.changes?.find(c => c.key === '$add')?.new || [];
            const dangerous = added
                .map(r => guild.roles.cache.get(r.id))
                .filter(r => r && (r.permissions.bitfield & DANGEROUS));
            if (!dangerous.length) return;
            await engine.onDestructiveAction(guild, actorId, 'dangerous role grant');
            // Hedef bot ya da yeni hesapsa rolu hemen geri al.
            const target = await guild.members.fetch(entry.targetId).catch(() => null);
            if (target && (target.user.bot || Date.now() - target.user.createdTimestamp < WEEK)) {
                await target.roles.remove(dangerous, '[Chamy Antiraid] Dangerous role given to a bot / new account').catch(() => {});
                await sendAlert(guild, cfg, {
                    title: '🛑 Dangerous role removed',
                    lines: [`<@${actorId}> gave **${dangerous.map(r => r.name).join(', ')}** to ${target.user.bot ? 'a bot' : 'a new account'} <@${target.id}>. Removed.`],
                });
            }
            return;
        }

        case AuditLogEvent.BotAdd: {
            if (actorId === guild.ownerId) return;
            await sendAlert(guild, cfg, {
                title: '🤖 Bot added',
                lines: [`<@${actorId}> added the bot <@${entry.targetId}>. If you don't know it, remove it — nuke bots are usually added this way.`],
            });
            return;
        }

        default:
            return;
    }
}

// --- Webhook spami ---
const INVITE = /(discord\.gg\/|discord(app)?\.com\/invite\/)/i;
const NSFW = /\b(nsfw|onlyfans|porn|p[o0]rn|nudes?|xxx|hentai|free\s*nitro)\b/i;
const HOOK_WINDOW_MS = 5_000;
const HOOK_FLOOD = 8;
const hooks = new Map(); // webhookId -> [{at, channelId, id}]
const killed = new Set();

async function onWebhookMessage(message) {
    if (!message.guild || !message.webhookId) return;
    // Baska bir sunucudan takip edilen duyuru kanallari (crosspost) mesru.
    if (message.flags?.has?.('IsCrosspost')) return;
    if (killed.has(message.webhookId)) { message.delete().catch(() => {}); return; }

    const cfg = await configStore.get(message.guild.id);
    if (!cfg.enabled) return;

    const now = Date.now();
    let list = hooks.get(message.webhookId);
    if (!list) { list = []; hooks.set(message.webhookId, list); }
    while (list.length && list[0].at < now - HOOK_WINDOW_MS) list.shift();
    list.push({ at: now, channelId: message.channelId, id: message.id });

    const content = message.content || '';
    const bad = INVITE.test(content) || (NSFW.test(content) && /https?:\/\//.test(content));
    if (list.length < HOOK_FLOOD && !bad) return;

    killed.add(message.webhookId);
    const reason = '[Chamy Antiraid] Webhook spam';
    const hook = await message.client.fetchWebhook(message.webhookId).catch(() => null);
    await hook?.delete(reason).catch(() => {});

    const byChannel = new Map();
    for (const e of list) {
        if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []);
        byChannel.get(e.channelId).push(e.id);
    }
    await Promise.all([...byChannel].map(([chId, ids]) =>
        message.guild.channels.cache.get(chId)?.bulkDelete(ids, true).catch(() => {})));
    hooks.delete(message.webhookId);

    await sendAlert(message.guild, cfg, {
        title: '🪝 Webhook spam stopped',
        lines: [
            `Webhook **${hook?.name || message.author?.username || message.webhookId}** was spamming${bad ? ' invite / NSFW links' : ''}. Deleted it and cleaned up.`,
            hook?.owner ? `It was created by <@${hook.owner.id}>.` : null,
        ],
    });
}

setInterval(() => {
    const cutoff = Date.now() - HOOK_WINDOW_MS;
    for (const [id, list] of hooks) if (!list.length || list[list.length - 1].at < cutoff) hooks.delete(id);
    if (killed.size > 500) killed.clear();
}, 60_000).unref?.();

module.exports = { onAuditEntry, onWebhookMessage };

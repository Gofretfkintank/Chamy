// lib/antiraid/alert.js
// Antiraid bildirimleri. Config'te alertChannelId varsa oraya embed, yoksa konsol.

const { EmbedBuilder } = require('discord.js');

async function sendAlert(guild, cfg, { title, lines }) {
    const body = lines.filter(Boolean).join('\n');
    if (!cfg.alertChannelId) {
        console.warn(`[ANTIRAID] ${guild.id} ${title}\n${body}`);
        return;
    }
    try {
        const ch = await guild.channels.fetch(cfg.alertChannelId).catch(() => null);
        if (!ch?.isTextBased?.()) return;
        await ch.send({
            embeds: [new EmbedBuilder()
                .setColor(0xE53935)
                .setTitle(title)
                .setDescription(body)
                .setTimestamp()],
        });
    } catch (err) {
        console.error('[ANTIRAID] alert send failed:', err.message);
    }
}

module.exports = { sendAlert };

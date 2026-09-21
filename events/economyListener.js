// events/economyListener.js
// OM-Bot Economy Listener
// ─────────────────────────────────────────────────────────────────────────────
// BOTS channel   → Madcardex / Ballsdex / F1dex catch mesajlarını dinler
//   Bot mesaj formatları:
//     Madcardex : "<@ID> You caught **ALFA ROMEO C41**! ..."
//     Ballsdex  : "<@ID> You caught **Argentina**! ..."
//     F1dex     : "<@ID> You signed **Nicholas Latifi**! ..."
//   → Direkt o kullanıcıya +COINS_PER_CATCH coin
//   → Anti-spam: aynı kullanıcı BOTS_COOLDOWN_MS içinde tekrar ödül alamaz
//
// LEVELS channel → Arcane level-up mesajlarını dinler
//   Format: "<@ID> has reached lap **N**. Will he finish the race?"
//   → Her yeni lap için +COINS_PER_LEVEL coin
//
// Both channels are per server now (channels:bots / channels:levels in
// /config). They used to be two ids from the OM server.
//
// Note: wallets are global per USER, not per server — coins earned in one
// server are spendable in every other. That was already true and is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const Economy = require('../models/Economy');
const cfg     = require('../lib/guildConfig');

// ── Ödül miktarları ────────────────────────────────────────────────────────
const COINS_PER_CATCH = 250;  // 10x scaled  // Madcardex / Ballsdex / F1dex catch
const COINS_PER_LEVEL = 500;  // 10x scaled  // Her yeni Arcane lap

// ── Anti-spam cooldown (ms) ────────────────────────────────────────────────
const BOTS_COOLDOWN_MS = 30_000; // 30 saniye

// ── Regex'ler ──────────────────────────────────────────────────────────────
// Madcardex, Ballsdex, F1dex - Much more flexible pattern
// Matches: "caught", "signed", and other variations
const CATCH_REGEX = /<@(\d+)>\s+You\s+(?:caught|signed|collected)\s+\*\*(.+?)\*\*/i;

// Arcane level-up
const ARCANE_REGEX = /<@(\d+)> has reached lap \*\*(\d+)\*\*/i;

// ─────────────────────────────────────────────────────────────────────────

module.exports = function (client) {

    client.on('messageCreate', async (message) => {
        if (!message.guild) return;
        if (!message.author.bot) return; // Sadece bot mesajlarını dinle

        // Only bot messages reach this line, and the lookup is cached, so this
        // stays cheap even in busy servers.
        const [levelsChannelId, botsChannelId] = await Promise.all([
            cfg.get(message.guildId, 'channels:levels'),
            cfg.get(message.guildId, 'channels:bots')
        ]);

        // ── LEVELS KANALI: Arcane level-up ──────────────────────────────────
        if (levelsChannelId && message.channel.id === levelsChannelId) {
            const match = message.content.match(ARCANE_REGEX);
            if (!match) return;

            const userId   = match[1];
            const newLevel = parseInt(match[2], 10);

            try {
                let wallet = await Economy.findOne({ userId });
                if (!wallet) wallet = new Economy({ userId });

                if (newLevel <= wallet.lastLevelRewarded) return;

                wallet.lastLevelRewarded = newLevel;
                wallet.level = newLevel;
                await wallet.addCoins(COINS_PER_LEVEL);

                await message.channel.send(
                    `🏎️ <@${userId}> reached lap **${newLevel}**! ` +
                    `**+${COINS_PER_LEVEL} 🪙** added to your wallet. ` +
                    `Balance: **${wallet.coins} 🪙**`
                );
            } catch (err) {
                console.error('[EconomyListener] Level reward error:', err);
            }
            return;
        }

        // ── BOTS KANALI: Catch / Sign tespiti ───────────────────────────────
        if (!botsChannelId || message.channel.id !== botsChannelId) return;

        const match = message.content.match(CATCH_REGEX);
        if (!match) return;

        const userId   = match[1];
        const itemName = match[2];

        try {
            let wallet = await Economy.findOne({ userId });
            if (!wallet) wallet = new Economy({ userId });

            // Anti-spam cooldown
            const now = Date.now();
            if (wallet.lastBotsReward && now - wallet.lastBotsReward.getTime() < BOTS_COOLDOWN_MS) return;

            wallet.correctAnswers += 1;
            wallet.lastBotsReward  = new Date();
            await wallet.addCoins(COINS_PER_CATCH);

            await message.channel.send(
                `🎴 <@${userId}> caught **${itemName}** and earned **+${COINS_PER_CATCH} 🪙**! ` +
                `Balance: **${wallet.coins} 🪙**`
            );
        } catch (err) {
            console.error('[EconomyListener] Catch reward error:', err);
        }
    });

};

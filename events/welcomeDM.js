// events/welcomeDM.js
// Yeni üye DM'i:
//  1. Statik embed (mevcut görsel + kanal linkleri) — her zaman gönderilir
//  2. Gemini ile knowledge base'den üretilmiş kısa ek mesaj — varsa gönderilir

const { EmbedBuilder }       = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getKnowledgeContext } = require('../services/learner');

const BANNER_URL = 'https://cdn.discordapp.com/attachments/1486039954625790113/1498294574257279016/OMMr.png?ex=69f0a30f&is=69ef518f&hm=bc22ecc29576a6e207d21d53fe206cddd2a164d24759f0173e69fddeedb5b568&';
const LOGO_URL   = 'https://cdn.discordapp.com/attachments/1486039954625790113/1498294579340771338/Untitled37_20251212225943-1.png?ex=69f0a310&is=69ef5190&hm=58b6c47cd41b0fae4a82aba820ec396dd219c0ddeb7ddfb7fc67f49122d101c8&';

let _genAI = null;
function getGemini() {
    if (!_genAI && process.env.GEMINI_API_KEY) {
        _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return _genAI;
}

module.exports = (client) => {
    // The welcome text, links and art are all OM's, so this stays off in other
    // servers. The home guild is always included: GUILD_ID_* doubled as the old
    // command whitelist, and clearing them to open the bot up would otherwise
    // quietly switch off OM's own welcome message too.
    const { LEGACY_GUILD_ID } = require('../lib/legacySeed');
    const ALLOWED_GUILDS = [
        LEGACY_GUILD_ID,
        process.env.GUILD_ID_1,
        process.env.GUILD_ID_2
    ].filter(Boolean);

    client.on('guildMemberAdd', async member => {
        if (!ALLOWED_GUILDS.includes(member.guild.id)) return;

        // ── 1. Statik embed — mevcut, her zaman gönder ──────────────────────
        const embed = new EmbedBuilder()
            .setColor('#1a1a1a')
            .setTitle('🏁 Welcome to Olzhasstik Motorsports!')
            .setDescription(
                `Hey **${member.user.username}**, glad to have you on the grid! 🎉\n\n` +
                `Before you hit the track, take a moment to read through the channels below.`
            )
            .addFields(
                {
                    name: '📋 Rules',
                    value:
                        '<#1447147256347365537> — Server Rules\n' +
                        '<#1447147377394843719> — Driver Rules\n' +
                        '<#1447147511574822972> — Safety Car Rules',
                    inline: false
                },
                {
                    name: '🎭 Self Roles',
                    value: '<#1452713858027487384> — Pick your roles here',
                    inline: false
                },
                {
                    name: '❓ FAQ',
                    value: '<#1489488289533526178> — Got questions? Start here',
                    inline: false
                },
                {
                    name: '🏎️ Ready to race?',
                    value: 'Use `/register` in the server to enter the league database!',
                    inline: false
                }
            )
            .setThumbnail(LOGO_URL)
            .setImage(BANNER_URL)
            .setFooter({ text: 'Olzhasstik Motorsports • Racing League' })
            .setTimestamp();

        try {
            await member.user.send({ embeds: [embed] });
            console.log(`[WELCOME DM] ✅ Embed gönderildi → ${member.user.tag}`);
        } catch (err) {
            console.warn(`[WELCOME DM] ⚠️ DM kapalı → ${member.user.tag}: ${err.message}`);
            return; // DM kapalıysa ek mesaj da gönderilemez, çık
        }

        // ── 2. Gemini ile knowledge base'den kısa ek mesaj (fire-and-forget) ─
        try {
            const knowledgeCtx = await getKnowledgeContext(member.guild.id);
            if (!knowledgeCtx) return; // Henüz öğrenme yapılmamış, sadece embed yeterli

            const genAI = getGemini();
            if (!genAI) return;

            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
            });

            const prompt = `You are Ommy, the assistant bot of Olzhasstik Motorsports Discord server.
"${member.user.username}" just joined the server.
Based on the info below, write a short friendly follow-up message. The static welcome embed was already sent.

RULES:
- Max 3-4 sentences
- Match the server's language style (mostly English, casual)
- Use the actual server knowledge (registration, format, schedule etc.)
- Don't start with "Welcome" — the embed already said that
- You are Ommy, not an AI
- Keep emojis minimal

SERVER KNOWLEDGE:
${knowledgeCtx}

Write ONLY the message, nothing else.`;

            const result  = await model.generateContent(prompt);
            const aiText  = result.response.text()?.trim();

            if (aiText && aiText.length > 10) {
                await member.user.send(aiText);
                console.log(`[WELCOME DM] ✅ AI ek mesaj gönderildi → ${member.user.tag}`);
            }
        } catch (err) {
            // AI mesajı başarısız olsa bile embed zaten gitti, sorun değil
            console.warn(`[WELCOME DM] AI mesaj hatası → ${err.message}`);
        }
    });
};

// services/learner.js
// ─────────────────────────────────────────────────────────────────────────────
// Ommy Active Learning — Claude Sonnet 4.6 ile kanal taraması
//
// • Kanalları tarar, mesajları Claude'a gönderir
// • Claude yapılandırılmış JSON döndürür (kategori + fact + confidence)
// • OmKnowledge MongoDB koleksiyonuna yazar (upsert + merge)
// • getKnowledgeContext() → ommy.js system prompt'una inject için
// ─────────────────────────────────────────────────────────────────────────────

const OmKnowledge = require('../models/OmKnowledge');
const { ChannelType } = require('discord.js');

const MAX_MESSAGES_PER_CHANNEL = 80;
const gemma = require('../lib/gemma');

// ── Model çağrıları ────────────────────────────────────────────────────────
// Eskiden Claude Sonnet'e gidiyordu; 30-40 sunucuda maliyet saçma olacağı için
// artık Gemma (Gemini API, aynı GEMINI_API_KEY). İsimler çağıran yerler
// değişmesin diye aynı bırakıldı.
async function callClaude(systemPrompt, userPrompt, maxTokens = 2048) {
    return gemma.generate(systemPrompt, userPrompt, [], maxTokens);
}

// images: [{ base64: string, mimeType: string }]
async function callClaudeVision(systemPrompt, textPrompt, images = []) {
    return gemma.generate(systemPrompt, textPrompt, images, 2048);
}

// ── Bir Discord attachment URL'sini base64'e çevir ─────────────────────────
async function fetchImageAsBase64(url) {
    try {
        const res    = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const ct     = res.headers.get('content-type') || 'image/jpeg';
        const mime   = ct.split(';')[0].trim();
        if (!mime.startsWith('image/')) return null;
        const buf    = await res.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        return { base64, mimeType: mime };
    } catch {
        return null;
    }
}

// ── Tek kanaldan bilgi çıkar ────────────────────────────────────────────────
async function learnFromMessages(channelName, channelId, messages, guildName = 'a sim-racing community') {
    if (messages.length === 0) return [];

    const messagesText = messages
        .slice(0, 60)
        .map(m => `[${m.isStaff ? 'STAFF' : 'ÜYE'}] ${m.author}: ${m.content}`)
        .join('\n');

    const system = `You are a knowledge extraction assistant for the Discord server "${guildName}".
You extract permanent, structured facts about the server from Discord channel messages.

EXTRACT:
- Registration / joining process
- Race format and how it works
- Server / race rules, penalty system
- Event schedule, race days
- Roles and their meanings
- Channel purposes
- Points / economy system
- General server info

DO NOT EXTRACT:
- Casual chat, greetings, temporary discussions
- Race results or live news
- Personal messages

RULES:
- Only write what is explicitly stated in the messages — no interpretation
- Each fact in English, clear, 1-3 sentences max
- Confidence: 0.9+ if written by staff, 0.7 if by member
- If there is no permanent knowledge to learn, return an empty array

Return ONLY valid JSON, nothing else:
{
  "knowledge": [
    {
      "category": "registration",
      "key": "how_to_register",
      "fact": "To join the league, go to the registration channel and use the /register command.",
      "confidence": 0.9
    }
  ]
}

Categories: registration | race_format | rules | schedule | roles | channels | economy | general`;

    const user = `Channel: #${channelName}\n\nMessages:\n${messagesText}`;

    try {
        const raw  = await callClaude(system, user);
        // JSON bloğunu çıkar (markdown fence varsa temizle)
        const json = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(json);

        return (parsed.knowledge || []).map(item => ({
            ...item,
            sources: [{
                channelId,
                channelName,
                messageSnippet: messages[0]?.content?.slice(0, 120) || '',
            }],
        }));
    } catch (err) {
        console.error(`[LEARNER] #${channelName} parse error:`, err.message);
        return [];
    }
}

// ── Knowledge'ı MongoDB'ye yaz (upsert + merge) ────────────────────────────
async function saveKnowledge(guildId, items) {
    let saved = 0, updated = 0;

    for (const item of items) {
        if (!item.key || !item.fact || !item.category) continue;

        const compositeKey = `${item.category}:${item.key}`;

        try {
            const existing = await OmKnowledge.findOne({ guildId, key: compositeKey });

            if (existing) {
                // Yüksek confidence varsa fact'i güncelle
                if ((item.confidence || 0.7) >= (existing.confidence || 0)) {
                    existing.fact       = item.fact;
                    existing.confidence = item.confidence || 0.7;
                }
                // Kaynakları merge et (duplicate'siz)
                const incoming = item.sources || [];
                for (const src of incoming) {
                    if (!existing.sources.find(s => s.channelId === src.channelId)) {
                        existing.sources.push(src);
                    }
                }
                existing.sources = existing.sources.slice(0, 5);
                await existing.save();
                updated++;
            } else {
                await OmKnowledge.create({
                    guildId,
                    category:   item.category,
                    key:        compositeKey,
                    fact:       item.fact,
                    confidence: item.confidence || 0.7,
                    sources:    item.sources || [],
                    active:     true,
                });
                saved++;
            }
        } catch (err) {
            if (err.code === 11000) {
                // Race condition: unique index çakışması — güvenle atla
            } else {
                console.error('[LEARNER] Kayıt hatası:', err.message);
            }
        }
    }

    return { saved, updated };
}

// ── Forum kanalını tara (her thread = bir başvuru/içerik) ─────────────────
async function scanForumChannel(forumChannel, guildId, onProgress = null) {
    const forumName = forumChannel.name;
    if (onProgress) onProgress(`📋 Scanning forum: #${forumName}`);

    let allThreads = [];
    try {
        const { threads: active }   = await forumChannel.threads.fetchActive();
        const { threads: archived } = await forumChannel.threads.fetchArchived({ limit: 100 });
        allThreads = [...active.values(), ...archived.values()];
    } catch (err) {
        console.error(`[LEARNER] Forum thread fetch hatası #${forumName}:`, err.message);
        return { saved: 0, updated: 0 };
    }

    if (allThreads.length === 0) {
        if (onProgress) onProgress(`⬛ #${forumName} — no threads found`);
        return { saved: 0, updated: 0 };
    }

    // Her thread'den mesajları + resimleri topla
    const threads = [];
    for (const thread of allThreads) {
        try {
            const msgs   = await thread.messages.fetch({ limit: 20 });
            const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            if (sorted.length === 0) continue;

            // Tüm mesajların text içeriğini birleştir
            const textContent = sorted
                .map(m => m.content?.trim())
                .filter(Boolean)
                .join('\n---\n')
                .slice(0, 1500);

            // Tüm mesajlardaki resim attachment'larını topla
            const imageUrls = [];
            for (const msg of sorted) {
                for (const [, att] of msg.attachments) {
                    const mime = att.contentType || '';
                    if (mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(att.name || '')) {
                        imageUrls.push({ url: att.url, mimeType: mime || 'image/jpeg' });
                    }
                }
                // Embed içindeki resimler
                for (const emb of msg.embeds || []) {
                    if (emb.image?.url) imageUrls.push({ url: emb.image.url, mimeType: 'image/jpeg' });
                    if (emb.thumbnail?.url) imageUrls.push({ url: emb.thumbnail.url, mimeType: 'image/jpeg' });
                }
            }

            threads.push({
                title:     thread.name,
                author:    sorted[0].author.username,
                text:      textContent,
                imageUrls: imageUrls.slice(0, 5), // max 5 resim per thread
            });
        } catch { /* erişilemeyen thread'i atla */ }

        await new Promise(r => setTimeout(r, 300));
    }

    if (threads.length === 0) {
        if (onProgress) onProgress(`⬛ #${forumName} — no readable content found`);
        return { saved: 0, updated: 0 };
    }

    // Thread'leri ikiye ayır: resimli (pist haritası vs.) ve text-only (başvuru)
    const imageThreads = threads.filter(t => t.imageUrls.length > 0);
    const textThreads  = threads.filter(t => t.imageUrls.length === 0);

    let totalSaved = 0, totalUpdated = 0;

    // ── Text-only thread'ler (başvuru formları) ────────────────────────────
    if (textThreads.length > 0) {
        const system = `You are extracting structured knowledge from a Discord forum channel in the sim-racing Discord server "${forumChannel.guild.name}".

Each "thread" is a driver or team application. Extract facts to answer:
- "What number does X prefer?"
- "Where is X from?"
- "What team does X want to join?"
- "What does the application require?"

RULES:
- English only. No private real names/addresses — Discord username is fine
- Driver-specific facts preferred (preferred number, nationality, team choice)
- Also extract structural facts about the application format
- 1-2 sentences, confidence 0.85, key: snake_case unique

Return ONLY valid JSON:
{ "knowledge": [{ "category": "registration", "key": "pilot_preferred_number_gofretfkintank", "fact": "Driver gofretfkintank prefers racing number 7.", "confidence": 0.85 }] }
Categories: registration | general`;

        const dump = textThreads
            .map((t, i) => `--- Thread ${i + 1}: "${t.title}" (by ${t.author}) ---\n${t.text}`)
            .join('\n\n');

        try {
            const raw    = await callClaude(system, `Forum: #${forumName}\n\n${dump}`);
            const json   = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(json);
            const items  = (parsed.knowledge || []).map(item => ({
                ...item,
                sources: [{ channelId: forumChannel.id, channelName: forumName, messageSnippet: '' }],
            }));
            if (items.length > 0) {
                const r = await saveKnowledge(guildId, items);
                totalSaved   += r.saved;
                totalUpdated += r.updated;
                if (onProgress) onProgress(`✅ #${forumName} (applications) — ${items.length} facts (${r.saved} new, ${r.updated} updated)`);
            }
        } catch (err) {
            console.error(`[LEARNER] Forum text parse #${forumName}:`, err.message);
        }
    }

    // ── Resimli thread'ler (pist haritaları, araç resimleri vs.) ──────────
    for (const thread of imageThreads) {
        try {
            // Resimleri base64'e çevir
            const images = [];
            for (const imgRef of thread.imageUrls) {
                const img = await fetchImageAsBase64(imgRef.url);
                if (img) images.push(img);
            }
            if (images.length === 0) continue;

            const system = `You are analyzing images from a Discord forum thread in the sim-racing Discord server "${forumChannel.guild.name}".

The thread may contain track maps, circuit layouts, car liveries, or other sim-racing visuals.

If this is a TRACK MAP or CIRCUIT LAYOUT:
- Describe the circuit characteristics (technical, fast, street circuit, etc.)
- Note key corners, chicanes, hairpins
- Identify likely overtaking spots (after long straights, heavy braking zones)
- Note any unusual or distinctive features
- Give an overall difficulty/character assessment

If this is something else (car livery, settings screenshot, etc.):
- Describe what you see and what's relevant to a sim-racing league

RULES:
- English only, factual observations only
- 1-3 facts per image, each 1-2 sentences, confidence 0.8
- key: snake_case unique (e.g. "track_monza_layout", "track_baku_overtaking")

Return ONLY valid JSON:
{ "knowledge": [{ "category": "general", "key": "track_baku_layout", "fact": "The Baku street circuit features a long main straight ideal for DRS overtaking into T1, combined with a very tight castle section with narrow walls requiring precise driving.", "confidence": 0.8 }] }
Categories: general | race_format`;

            const textHint = thread.text
                ? `Thread title: "${thread.title}"\nText content: ${thread.text.slice(0, 300)}`
                : `Thread title: "${thread.title}"`;

            const raw    = await callClaudeVision(system, textHint, images);
            const json   = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(json);
            const items  = (parsed.knowledge || []).map(item => ({
                ...item,
                sources: [{ channelId: forumChannel.id, channelName: thread.title, messageSnippet: '' }],
            }));

            if (items.length > 0) {
                const r = await saveKnowledge(guildId, items);
                totalSaved   += r.saved;
                totalUpdated += r.updated;
                if (onProgress) onProgress(`🗺️ "${thread.title}" — ${images.length} images → ${items.length} facts (${r.saved} new)`);
            }

            await new Promise(r => setTimeout(r, 800));
        } catch (err) {
            console.error(`[LEARNER] Forum vision #${thread.title}:`, err.message);
            if (onProgress) onProgress(`⚠️ "${thread.title}" image analysis failed: ${err.message.slice(0, 50)}`);
        }
    }

    if (totalSaved + totalUpdated === 0) {
        if (onProgress) onProgress(`⬛ #${forumName} — no extractable facts found`);
    }

    return { saved: totalSaved, updated: totalUpdated };
}

// ── Kanal dizini oluştur — tüm kanalların amacını tek Claude çağrısıyla öğren ──
// Kanal adı + topic + kategori yapısını okur, "X kanalına git" tarzı
// navigasyon bilgilerini channels:* olarak kaydeder.
async function buildChannelDirectory(guild, guildId, onProgress = null) {
    await guild.channels.fetch().catch(() => {});

    // Kategori → kanallar yapısını oluştur
    const categories = new Map(); // categoryName → [{name, topic}]
    const uncategorized = [];

    for (const [, ch] of guild.channels.cache) {
        const isText  = ch.isTextBased() && !ch.isThread();
        const isForum = ch.type === ChannelType.GuildForum;
        if (!isText && !isForum) continue;
        const entry = {
            name:  ch.name,
            id:    ch.id,
            topic: (ch.topic || '').slice(0, 200),
            type:  isForum ? 'forum' : 'text',
        };
        if (ch.parent) {
            const cat = ch.parent.name;
            if (!categories.has(cat)) categories.set(cat, []);
            categories.get(cat).push(entry);
        } else {
            uncategorized.push(entry);
        }
    }

    // Tek bir metin bloğu oluştur
    let structureText = '';
    for (const [catName, channels] of categories) {
        structureText += `\n[CATEGORY: ${catName}]\n`;
        for (const ch of channels) {
            structureText += `  #${ch.name} [${ch.type || 'text'}]`;
            if (ch.topic) structureText += ` — topic: "${ch.topic}"`;
            structureText += '\n';
        }
    }
    if (uncategorized.length > 0) {
        structureText += '\n[UNCATEGORIZED]\n';
        for (const ch of uncategorized) {
            structureText += `  #${ch.name}`;
            if (ch.topic) structureText += ` — topic: "${ch.topic}"`;
            structureText += '\n';
        }
    }

    if (!structureText.trim()) return { saved: 0, updated: 0 };

    const system = `You are building a channel directory for a sim-racing Discord server called "${guild.name}".

You will receive a PARTIAL channel structure: category names, channel names, and their topics.

Your job: For each channel where you can confidently describe its PURPOSE and what a member should DO there, generate a concise English fact. Focus on ACTION-ORIENTED descriptions — what should a user go to this channel for?

Special attention to channels for:
- Applying for roles (FIA, pit crew, safety car, marshal, steward, etc.)
- Registering for championships or seasons
- Submitting complaints, reports, or tickets
- Finding rules, guides, or info
- Race announcements, standings, results
- Economy / casino / bot commands

RULES:
- Only include channels where the purpose is reasonably clear from the name or topic
- Skip generic channels (general chat, off-topic, memes) unless they have a clear topic
- English only, 1-2 sentences per fact
- Key must be snake_case, unique, descriptive (e.g. "ticket_channel_purpose")
- Return ONLY valid JSON, nothing else — no markdown, no extra text

{
  "channels": [
    {
      "channelName": "ticket",
      "key": "ticket_channel_purpose",
      "fact": "The #ticket channel is where members submit applications for staff or official roles such as FIA, pit crew, safety car (SC), and marshal — open a ticket there to apply."
    }
  ]
}`;

    // Kanal satırlarını topla, 20'lik batch'lere böl
    const allLines = structureText.split('\n').filter(l => l.trim());
    const BATCH_SIZE = 20;
    const batches = [];
    for (let i = 0; i < allLines.length; i += BATCH_SIZE) {
        batches.push(allLines.slice(i, i + BATCH_SIZE).join('\n'));
    }

    let totalSaved = 0, totalUpdated = 0, totalItems = 0;

    for (let i = 0; i < batches.length; i++) {
        const user = `Server channel structure (batch ${i + 1}/${batches.length}):\n${batches[i]}`;
        try {
            const raw    = await callClaude(system, user, 2048);
            const json   = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(json);

            const items = (parsed.channels || []).map(ch => ({
                category:   'channels',
                key:        `channel_dir_${ch.key}`,
                fact:       ch.fact,
                confidence: 0.9,
                sources:    [{ channelId: '', channelName: ch.channelName, messageSnippet: '' }],
            }));

            if (items.length > 0) {
                const result = await saveKnowledge(guildId, items);
                totalSaved   += result.saved;
                totalUpdated += result.updated;
                totalItems   += items.length;
            }

            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.error(`[LEARNER] buildChannelDirectory batch ${i + 1}:`, err.message);
            if (onProgress) onProgress(`⚠️ Channel directory batch ${i + 1} error: ${err.message.slice(0, 60)}`);
        }
    }

    if (totalItems > 0 && onProgress) {
        onProgress(`🗺️ Channel directory: ${totalItems} channels learned (${totalSaved} new, ${totalUpdated} updated)`);
    }
    return { saved: totalSaved, updated: totalUpdated };
}


// @param guild         Discord Guild objesi
// @param channelFilter "all" veya kanal ismi substring'i
// @param onProgress    (string) => void  — ilerleme callback'i
async function learnFromGuild(guild, channelFilter = 'all', onProgress = null) {
    if (!process.env.GEMINI_API_KEY) {
        if (onProgress) onProgress('❌ `GEMINI_API_KEY` is not set in Railway env.');
        return { error: 'GEMINI_API_KEY missing' };
    }

    await guild.channels.fetch().catch(() => {});

    // Text kanalları
    let targetChannels = [...guild.channels.cache.values()].filter(c =>
        c.isTextBased() && !c.isThread()
    );

    // Forum kanalları
    let forumChannels = [...guild.channels.cache.values()].filter(c =>
        c.type === ChannelType.GuildForum
    );

    if (channelFilter !== 'all') {
        const matchedCategory = [...guild.channels.cache.values()].find(c =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase().includes(channelFilter.toLowerCase())
        );

        if (matchedCategory) {
            targetChannels = targetChannels.filter(c => c.parentId === matchedCategory.id);
            forumChannels  = forumChannels.filter(c => c.parentId === matchedCategory.id);
            if (onProgress) onProgress(`📂 Category: **${matchedCategory.name}** — ${targetChannels.length} text + ${forumChannels.length} forum channels`);
        } else {
            targetChannels = targetChannels.filter(c =>
                c.name.toLowerCase().includes(channelFilter.toLowerCase())
            );
            forumChannels = forumChannels.filter(c =>
                c.name.toLowerCase().includes(channelFilter.toLowerCase())
            );
        }
    }

    // Öncelikli kanallar öne al — limit YOK, tüm kanallar taranır
    const priorityKeywords = [
        'kural', 'rule', 'bilgi', 'info', 'duyuru', 'announce',
        'kayıt', 'register', 'rehber', 'guide', 'hakkında', 'about',
        'genel', 'general', 'takvim', 'schedule', 'format', 'nasıl', 'how', 'faq',
    ];
    targetChannels.sort((a, b) => {
        const aP = priorityKeywords.some(k => a.name.toLowerCase().includes(k)) ? 0 : 1;
        const bP = priorityKeywords.some(k => b.name.toLowerCase().includes(k)) ? 0 : 1;
        return aP - bP;
    });

    if (targetChannels.length === 0 && forumChannels.length === 0) {
        if (onProgress) onProgress('❌ No channels found to scan.');
        return { error: 'No channels found' };
    }

    if (onProgress) onProgress(`📡 Scanning ${targetChannels.length} text + ${forumChannels.length} forum channels...`);

    // ── Kanal dizini pass'i — tüm sunucunun kanal yapısını öğren ──────────
    // Bu sadece "all" scan'de veya channelFilter yoksa çalışır (yani tüm
    // sunucuyu tararken kanal directory'sini de çıkar).
    if (channelFilter === 'all') {
        if (onProgress) onProgress('🗺️ Building channel directory...');
        await buildChannelDirectory(guild, guild.id, onProgress);
    }

    let totalSaved = 0, totalUpdated = 0, channelsScanned = 0;

    for (const channel of targetChannels) {
        try {
            const fetched = await channel.messages.fetch({ limit: MAX_MESSAGES_PER_CHANNEL });
            const entries = [];

            for (const [, msg] of fetched) {
                let textContent = msg.content?.trim() || '';

                // Embed içeriğini de çek (kural kitabı, duyuru gibi embed mesajlar)
                for (const emb of msg.embeds || []) {
                    const parts = [];
                    if (emb.title)       parts.push(`[${emb.title}]`);
                    if (emb.description) parts.push(emb.description);
                    for (const f of emb.fields || []) {
                        parts.push(`${f.name}: ${f.value}`);
                    }
                    if (parts.length > 0) {
                        textContent = textContent
                            ? textContent + '\n' + parts.join('\n')
                            : parts.join('\n');
                    }
                }

                if (textContent.length < 15) continue;
                entries.push({
                    author:  msg.author.username,
                    content: textContent.slice(0, 800),
                    isStaff: !!(msg.member?.permissions.has(8n)), // Administrator
                });
            }

            // Pinned mesajları da çek — önemli bilgiler genellikle pinlenir
            try {
                const pinned = await channel.messages.fetchPinned();
                for (const [, msg] of pinned) {
                    let textContent = msg.content?.trim() || '';
                    for (const emb of msg.embeds || []) {
                        const parts = [];
                        if (emb.title)       parts.push(`[${emb.title}]`);
                        if (emb.description) parts.push(emb.description);
                        for (const f of emb.fields || []) parts.push(`${f.name}: ${f.value}`);
                        if (parts.length > 0) textContent = textContent ? textContent + '\n' + parts.join('\n') : parts.join('\n');
                    }
                    if (textContent.length < 15) continue;
                    // Pinned'i zaten varsa duplicate olmasın
                    const alreadyIn = entries.some(e => e.content.includes(textContent.slice(0, 80)));
                    if (!alreadyIn) entries.push({
                        author:  msg.author.username,
                        content: `[PINNED] ${textContent.slice(0, 800)}`,
                        isStaff: true, // pinned = staff onaylı bilgi
                    });
                }
            } catch { /* pinned fetch başarısız, devam */ }

            if (entries.length < 1) continue;

            // Staff mesajları öne al (daha güvenilir bilgi kaynağı)
            const ordered = [
                ...entries.filter(e => e.isStaff),
                ...entries.filter(e => !e.isStaff),
            ];

            const items = await learnFromMessages(channel.name, channel.id, ordered, guild.name);

            if (items.length > 0) {
                const { saved, updated } = await saveKnowledge(guild.id, items);
                totalSaved   += saved;
                totalUpdated += updated;
                channelsScanned++;
                if (onProgress) {
                    onProgress(`✅ #${channel.name} — ${items.length} facts (${saved} new, ${updated} updated)`);
                }
            } else {
                if (onProgress) onProgress(`⬛ #${channel.name} — no useful facts found`);
            }

            // Claude API rate limit koruması
            await new Promise(r => setTimeout(r, 700));

        } catch (err) {
            console.error(`[LEARNER] Kanal ${channel.name}:`, err.message);
            if (onProgress) onProgress(`❌ #${channel.name} — error: ${err.message.slice(0, 60)}`);
        }
    }

    // ── Forum kanallarını tara ──────────────────────────────────────────────
    for (const forumChannel of forumChannels) {
        try {
            const { saved, updated } = await scanForumChannel(forumChannel, guild.id, onProgress);
            totalSaved   += saved;
            totalUpdated += updated;
            if (saved + updated > 0) channelsScanned++;
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[LEARNER] Forum ${forumChannel.name}:`, err.message);
            if (onProgress) onProgress(`❌ #${forumChannel.name} — error: ${err.message.slice(0, 60)}`);
        }
    }

    return { channelsScanned, totalSaved, totalUpdated };
}

// ── Knowledge context → ommy.js system prompt injection ────────────────────
async function getKnowledgeContext(guildId) {
    try {
        // Channels kategorisi her zaman önce gelsin (navigasyon soruları için kritik)
        const channelItems = await OmKnowledge.find({ guildId, active: true, category: 'channels' })
            .sort({ confidence: -1 })
            .limit(30)
            .lean();

        const otherItems = await OmKnowledge.find({ guildId, active: true, category: { $ne: 'channels' } })
            .sort({ confidence: -1 })
            .limit(50)
            .lean();

        const items = [...channelItems, ...otherItems];
        if (!items.length) return '';

        const catLabels = {
            registration: 'REGISTRATION & JOINING',
            race_format:  'RACE FORMAT',
            rules:        'RULES & PENALTIES',
            schedule:     'SCHEDULE & CALENDAR',
            roles:        'ROLES',
            channels:     'CHANNELS',
            economy:      'ECONOMY & POINTS',
            general:      'GENERAL',
        };

        const grouped = {};
        for (const item of items) {
            const cat = item.category;
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item.fact);
        }

        let ctx = '\n\n---\n🧠 SERVER KNOWLEDGE BASE (learned from channel scan):\n';
        for (const [cat, facts] of Object.entries(grouped)) {
            ctx += `\n[${catLabels[cat] || cat.toUpperCase()}]\n`;
            for (const f of facts) ctx += `• ${f}\n`;
        }
        ctx += '\nUse this knowledge when answering. These facts were learned from scanning the server.\n---\n';

        return ctx;
    } catch (err) {
        console.error('[LEARNER] getKnowledgeContext hatası:', err.message);
        return '';
    }
}

module.exports = { learnFromGuild, getKnowledgeContext, saveKnowledge, callClaude, callClaudeVision, fetchImageAsBase64 };

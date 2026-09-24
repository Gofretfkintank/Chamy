// services/leagueSync.js
// ─────────────────────────────────────────────────────────────────────────────
// Chamy'nin öğrendiği sunucu profillerini Mad+ lobby sunucusuna yollar →
// uygulamadaki More > Leagues sayfası ve Home'daki Upcoming Sessions.
// AI yok, tek bir HTTP isteği.
//
// Her seferinde TÜM liste gider (POST /v1/leagues/sync): bot'un çıktığı
// sunucu bir sonraki sync'te listeden düşer, lobby yeniden başlarsa da en geç
// 5 dk'da tekrar dolar.
//
// Herkese açık alanlar: sunucu adı/ikonu/banner'ı/açıklaması, üye sayısı,
// owner adı, yarış düzeni, ligler, takvim, puan tablosu, host'lar, yoğun
// gün/saat. Aktif üye listesi ve staff listesi GİTMEZ.
//
// Sürücü rolleri ("F1 Driver", "F2 Driver", "GT3 Driver"...): rol adından seri
// çıkarılır, takvimdeki her etkinlik o seriye uyan rollere eşlenir. Rol
// üyelerinin Discord ID'leri SADECE lobby'ye gider (Home'da "benim
// yarışlarım" için) — lobby bunları hiçbir herkese açık endpoint'te dönmez.
// Üyelik her push'ta Discord'dan canlı okunur, 5 dk'da bir güncel.
//
// Env: MADPLUS_LOBBY_URL        (https://madplus-lobby-production.up.railway.app)
//      MADPLUS_LEAGUE_SYNC_KEY  (lobby servisindeki ile aynı değer)
// ─────────────────────────────────────────────────────────────────────────────

const { PermissionsBitField, ChannelType } = require('discord.js');
const ServerProfile = require('../models/ServerProfile');

// Mad+'ın desteklediği oyunlar. Başka oyun eklenince buraya bir regex eklenir.
// Chamy'nin olduğu ama bu oyunları oynamayan sunucular (GTA, FX Racer...) Mad+
// Leagues'te listelenmez; Chamy orada yine normal çalışır.
const SUPPORTED_GAMES = [/mad\s*car/i];

// NFKC: "𝙈𝙖𝙙𝙘𝙖𝙧 𝙍𝙖𝙘𝙞𝙣𝙜" gibi süslü unicode adlar düz "Madcar Racing" olur.
const matchesGame = (text) => {
    const plain = String(text || '').normalize('NFKC');
    return SUPPORTED_GAMES.some(re => re.test(plain));
};

function racesSupportedGame(p, guild) {
    // Sunucunun kendi adi/aciklamasi/kanallari "Madcar" diyorsa bu KESIN sinyal.
    // Gemma'nin "games" alani (sezon adini oyunla karistirip "F1 2020" gibi
    // yanlis bir sey yazmasi mumkun) bunu asla tek basina ELEYEMEZ -- sadece
    // ikisi de aciyken (games var ama Madcar demiyor VE isimde de yok) filtrelenir.
    const channels = [...(guild?.channels?.cache?.values() || [])].map(c => c.name).join(' ');
    if (matchesGame(`${guild?.name || p.guildName} ${guild?.description || ''} ${channels}`)) return true;
    if (Array.isArray(p.games) && p.games.length) return p.games.some(matchesGame);
    // "games" hic cikarilmamissa (henuz taranmamis profil) adi da eslesmedi -> bilinmiyor sayma, disari birak
    return false;
}

// ── Sürücü rolleri ───────────────────────────────────────────────────────────────
// Unicode sınırları (\b Türkçe harflerde çalışmıyor, "sürücü" kaçardı).
const WORD = '(?<![\\p{L}\\p{N}])';
const END  = '(?![\\p{L}\\p{N}])';
const DRIVER_WORDS = 'drivers?|pilots?|pilotu|s[üu]r[üu]c[üu](?:s[üu])?|racers?';
const DRIVER_ROLE_RE = new RegExp(`${WORD}(?:${DRIVER_WORDS})${END}`, 'iu');
// "Driver Manager", "Driver Steward", "Driver Coordinator" gibi yonetim rolleri
const NOT_DRIVER_RE = new RegExp(
    `${WORD}(?:manager|coordinator|steward|admin|mod|moderator|staff|y[öo]netici|sorumlu|director|marshal)${END}`, 'iu');
// Seri adı çıkarırken rol adından atılan kelimeler: "F1 Driver" -> "f1",
// "Official GT3 Driver" -> "gt3", sadece "Driver" -> "" (tüm yarışlar).
const ROLE_NOISE_RE = new RegExp(
    `${WORD}(?:${DRIVER_WORDS}|role|official|main|reserve|yedek|team|tak[ıi]m|league|lig)${END}`, 'giu');

const MEMBER_REFRESH_MS = 60 * 60 * 1000;
const memberFetchedAt = new Map(); // guildId -> ms

const tokens = s => String(s || '')
    .normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().split(/\s+/).filter(Boolean);

function driverRolesOf(guild) {
    const F = PermissionsBitField.Flags;
    return [...guild.roles.cache.values()]
        .filter(r =>
            !r.managed && r.id !== guild.id &&
            DRIVER_ROLE_RE.test(r.name.normalize('NFKC')) &&
            !NOT_DRIVER_RE.test(r.name.normalize('NFKC')) &&
            // Admin/yönetim rolleri sürücü rolü sayılmaz ("Driver Manager" gibi)
            !r.permissions.has(F.Administrator) && !r.permissions.has(F.ManageGuild))
        .sort((a, b) => b.position - a.position)
        .slice(0, 25)
        .map(r => ({
            id:      r.id,
            name:    r.name,
            series:  tokens(r.name.normalize('NFKC').replace(ROLE_NOISE_RE, ' ')).join(' '),
            members: [...r.members.filter(m => !m.user.bot).keys()],
        }));
}

// Bir etkinlik hangi sürücü rollerini ilgilendiriyor?
//  • Seri adı boş rol (sadece "Driver") -> sunucunun tüm yarışları
//  • "F1" rolü -> seri/başlığında "f1" kelimesi geçen etkinlikler
function rolesForEvent(event, roles) {
    const eventTokens = new Set(tokens(`${event.series || ''} ${event.title || ''}`));
    return roles
        .filter(r => !r.series || r.series.split(' ').every(t => eventTokens.has(t)))
        .map(r => r.id);
}

// Rol üyeleri cache'ten okunuyor; cache'in eksik kalmaması için saatte bir tam liste.
async function ensureMembers(guild) {
    if (!guild.memberCount || guild.memberCount > 5000) return;
    const last = memberFetchedAt.get(guild.id) || 0;
    if (Date.now() - last < MEMBER_REFRESH_MS) return;
    memberFetchedAt.set(guild.id, Date.now());
    await guild.members.fetch().catch(() => {});
}

const WARN_EVERY_MS = 6 * 60 * 60 * 1000;
let lastWarnAt = 0;

// ── Davet linki (Leagues sayfasindaki "Join" butonu) ─────────────────────────
// Vanity URL varsa o. Yoksa Chamy BIR KEZ suresiz, sinirsiz bir davet olusturup
// ServerProfile.inviteUrl'e yazar; sonra hep onu kullanir. Yetki yoksa 6 saatte
// bir tekrar dener (sunucu yetkiyi sonradan verebilir).
const INVITE_RETRY_MS = 6 * 60 * 60 * 1000;
const inviteTriedAt = new Map(); // guildId -> ms

async function ensureInvite(guild, p) {
    if (guild.vanityURLCode) return `https://discord.gg/${guild.vanityURLCode}`;
    if (p.inviteUrl) return p.inviteUrl;
    if (Date.now() - (inviteTriedAt.get(guild.id) || 0) < INVITE_RETRY_MS) return null;
    inviteTriedAt.set(guild.id, Date.now());

    const me = guild.members.me;
    const F = PermissionsBitField.Flags;
    const textChannels = [...guild.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildText)
        .sort((a, b) => a.rawPosition - b.rawPosition);
    const channel = [guild.rulesChannel, guild.systemChannel, ...textChannels]
        .filter(Boolean)
        .find(c => me && c.permissionsFor(me)?.has([F.ViewChannel, F.CreateInstantInvite]));
    if (!channel) return null;

    try {
        const invite = await guild.invites.create(channel, {
            maxAge: 0, maxUses: 0, unique: false,
            reason: 'Mad+ Leagues page: permanent join link',
        });
        await ServerProfile.updateOne({ guildId: guild.id }, { $set: { inviteUrl: invite.url } });
        return invite.url;
    } catch (err) {
        console.warn(`[LEAGUE SYNC] invite for ${guild.name} failed: ${err.message}`);
        return null;
    }
}

function ms(d) {
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
}

function lobbyBase() {
    return (process.env.MADPLUS_LOBBY_URL || '')
        .trim()
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
        .replace(/\/+$/, '');
}

// Banner: sunucu banner'ı (boost 2), yoksa davet arka planı (splash, boost 1),
// yoksa discovery splash. Hiçbiri yoksa null — uygulama banner'ı hiç çizmez.
function bannerOf(guild) {
    const opts = { extension: 'png', size: 1024 };
    return guild?.bannerURL?.(opts)
        || guild?.splashURL?.(opts)
        || guild?.discoverySplashURL?.(opts)
        || null;
}

function snapshot(p, guild, inviteUrl) {
    const now = Date.now();
    const roles = driverRolesOf(guild);
    return {
        guildId:     p.guildId,
        name:        guild?.name || p.guildName || '',
        iconUrl:     guild?.iconURL?.({ extension: 'png', size: 256 }) || null,
        bannerUrl:   bannerOf(guild),
        description: guild?.description || null,
        memberCount: guild?.memberCount || p.memberCount || 0,
        ownerName:   p.ownerName || null,
        timezone:    p.timezone || null,
        inviteUrl:   inviteUrl || null,
        raceSchedule: {
            summary: p.raceSchedule?.summary || '',
            days:    p.raceSchedule?.days  || [],
            times:   p.raceSchedule?.times || [],
        },
        leagues: (p.leagues || []).map(l => ({ name: l.name, format: l.format, status: l.status })),
        hosts:   (p.hosts   || []).map(h => ({ name: h.name, detail: h.detail })),
        calendar: (p.calendar || [])
            .filter(e => !e.startsAt || new Date(e.startsAt).getTime() > now - 3 * 60 * 60 * 1000)
            .slice(0, 15)
            .map(e => ({
                title:    e.title || '',
                series:   e.series || '',
                track:    e.track || '',
                host:     e.host || '',
                startsAt: ms(e.startsAt),
                timeText: e.timeText || null,
                // Lobby'ye özel: Home'da "benim yarışlarım" eşlemesi. Herkese açık
                // endpoint'lerde lobby bunu siler.
                driverRoleIds: rolesForEvent(e, roles),
            })),
        standings: (p.standings || []).map(s => ({
            series: s.series || '',
            asOf:   ms(s.asOf),
            rows:   (s.rows || []).map(r => ({
                position: r.position ?? null,
                name:     r.name || '',
                team:     r.team || '',
                points:   r.points ?? null,
            })),
        })),
        busiestDays:  p.busiestDays  || [],
        peakHoursUtc: p.peakHoursUtc || [],
        // Lobby'ye özel (bkz. yukarı). Herkese açık tarafta sadece rol adı +
        // sürücü sayısı kalır, üye ID'leri kalır.
        driverRoles:  roles,
        updatedAt:    ms(p.refreshedAt),
    };
}

async function pushAll(client) {
    const base = lobbyBase();
    const key  = (process.env.MADPLUS_LEAGUE_SYNC_KEY || '').trim();
    if (!base || !key) {
        if (Date.now() - lastWarnAt > WARN_EVERY_MS) {
            lastWarnAt = Date.now();
            console.warn('[LEAGUE SYNC] MADPLUS_LOBBY_URL / MADPLUS_LEAGUE_SYNC_KEY not set — Mad+ Leagues page stays empty.');
        }
        return { skipped: true };
    }

    const profiles = await ServerProfile.find({}).lean();
    const leagues = [];
    for (const p of profiles) {
        const guild = client.guilds.cache.get(p.guildId);
        if (!guild) continue; // bot artık o sunucuda değil
        if (!racesSupportedGame(p, guild)) continue; // Madcar dışı sunucu
        if (driverRolesOf(guild).length) await ensureMembers(guild);
        leagues.push(snapshot(p, guild));
    }

    const res = await fetch(`${base}/v1/leagues/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-MadPlus-League-Key': key },
        body:    JSON.stringify({ leagues }),
        signal:  AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`lobby ${res.status}: ${text.slice(0, 200)}`);
    }
    return { pushed: leagues.length };
}

module.exports = { pushAll, driverRolesOf };

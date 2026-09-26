// lib/antiraid/cluster.js
// Davranissal analiz: yeni katilan hesaplarin birbirine benzeyip benzemedigi.
// Raid botlari genelde ayni saatlerde acilmis, benzer isimli, avatarsiz ya da
// ayni avatarli hesaplardir. Gercek uyeler ise birbirinden farklidir.
//
// Iki is yapar:
//   1) Yavas raid: dakikalara yayilmis girislerde bile benzer hesaplardan olusan
//      bir kume olusursa raid sayilir (hizli pencere bunu kacirir).
//   2) Dalga icinde ayiklama: raid dalgasina denk gelen GERCEK uye (eski hesap,
//      kendine ozgu avatar, kimseye benzemiyor) banlanmaz.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function features(member) {
    const u = member.user;
    return {
        userId: member.id,
        at: Date.now(),
        createdAt: u.createdTimestamp,
        avatar: u.avatar || null,           // null = varsayilan avatar
        name: (u.username || '').toLowerCase(),
        young: false,                        // cagiran doldurur (config'e bagli)
    };
}

// "raider_123", "raider.456", "Raider789" -> "raider"
function skeleton(name) {
    return name.replace(/[0-9_.\-]+/g, '').replace(/(.)\1+/g, '$1');
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 3; // bize sadece <=2 lazim
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = tmp;
        }
    }
    return prev[b.length];
}

function similarNames(a, b) {
    if (!a || !b) return false;
    const sa = skeleton(a), sb = skeleton(b);
    if (sa.length >= 3 && sa === sb) return true;
    if (a.length >= 6 && b.length >= 6 && levenshtein(a, b) <= 2) return true;
    return false;
}

/** Iki hesap arasinda kac benzerlik sinyali var (0-4). */
function similarity(f, o) {
    let s = 0;
    if (Math.abs(f.createdAt - o.createdAt) < 2 * HOUR) s++;   // ayni saatlerde acilmis
    if (f.avatar && f.avatar === o.avatar) s++;                // ayni avatar
    if (!f.avatar && !o.avatar) s++;                           // ikisi de varsayilan avatar
    if (similarNames(f.name, o.name)) s++;                     // benzer isim
    return s;
}

/** f'ye en az 2 sinyalle benzeyen diger hesaplar. */
function mates(f, pool) {
    return pool.filter(o => o.userId !== f.userId && similarity(f, o) >= 2);
}

/**
 * Supheli mi: genc hesap, varsayilan avatar + yeni hesap, ya da kumenin parcasi.
 * Eski hesap + kendine ozgu avatar + kimseye benzemiyor = gercek uye, dokunma.
 */
function isSuspect(f, pool) {
    if (f.young) return true;
    const ageDays = (Date.now() - f.createdAt) / DAY;
    if (!f.avatar && ageDays < 30) return true;
    return mates(f, pool).length >= 2;
}

module.exports = { features, similarity, mates, isSuspect };

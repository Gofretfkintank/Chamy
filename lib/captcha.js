// lib/captcha.js
// Gorsel captcha: 5 karakterlik kodu bozulmus bir PNG'ye cizer.
// - Karisik karakterler yok (0/O, 1/I/L): kullanici yanlis okumasin.
// - Her karakter farkli aci, boyut, renk ve konumda; ustunden egri cizgiler ve
//   gurultu gecer. Basit OCR botlarinin okumasini zorlastirir.
//
// @napi-rs/canvas hazir derlenmis gelir (native build gerekmez). Font olarak
// Dockerfile'da kurulan DejaVu kullanilir. Canvas yuklenemezse render() hata
// atar; cagiran taraf matematik sorusuna duser.

const crypto = require('crypto');
const fs = require('fs');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FONT_PATHS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

let canvasLib = null;
let fontFamily = 'sans-serif';
try {
    canvasLib = require('@napi-rs/canvas');
    const font = FONT_PATHS.find(p => fs.existsSync(p));
    if (font && canvasLib.GlobalFonts.registerFromPath(font, 'CaptchaFont')) fontFamily = 'CaptchaFont';
} catch (err) {
    console.warn('[CAPTCHA] canvas unavailable, math fallback will be used:', err.message);
}

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

function newCode(length = 5) {
    let s = '';
    for (let i = 0; i < length; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    return s;
}

function available() {
    return !!canvasLib;
}

function render(code) {
    if (!canvasLib) throw new Error('canvas unavailable');
    const W = 320, H = 110;
    const canvas = canvasLib.createCanvas(W, H);
    const g = canvas.getContext('2d');

    // Arka plan.
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b1f2b');
    bg.addColorStop(1, '#2a3043');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // Gurultu noktalari.
    for (let i = 0; i < 350; i++) {
        g.fillStyle = `rgba(255,255,255,${rand(0.04, 0.22).toFixed(2)})`;
        g.fillRect(rand(0, W), rand(0, H), randInt(1, 3), randInt(1, 3));
    }

    // Arkadaki soluk sahte karakterler (OCR'i sasirtmak icin).
    for (let i = 0; i < 6; i++) {
        g.save();
        g.translate(rand(0, W), rand(0, H));
        g.rotate(rand(-0.8, 0.8));
        g.font = `bold ${randInt(22, 34)}px "${fontFamily}"`;
        g.fillStyle = `rgba(255,255,255,0.07)`;
        g.fillText(ALPHABET[randInt(0, ALPHABET.length - 1)], 0, 0);
        g.restore();
    }

    // Asil karakterler.
    const step = W / (code.length + 1);
    for (let i = 0; i < code.length; i++) {
        g.save();
        g.translate(step * (i + 1) + rand(-8, 8), H / 2 + rand(-12, 12));
        g.rotate(rand(-0.45, 0.45));
        g.font = `bold ${randInt(40, 52)}px "${fontFamily}"`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = `hsl(${randInt(0, 359)}, ${randInt(65, 90)}%, ${randInt(62, 78)}%)`;
        g.fillText(code[i], 0, 0);
        g.restore();
    }

    // Ustten gecen egriler.
    for (let i = 0; i < 4; i++) {
        g.strokeStyle = `hsla(${randInt(0, 359)}, 80%, 70%, 0.65)`;
        g.lineWidth = rand(1.5, 3.5);
        g.beginPath();
        g.moveTo(0, rand(0, H));
        g.bezierCurveTo(rand(0, W), rand(0, H), rand(0, W), rand(0, H), W, rand(0, H));
        g.stroke();
    }

    return canvas.toBuffer('image/png');
}

module.exports = { newCode, render, available };

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../../Aether.env');
let cached;

function parseValue(value) {
    const trimmed = String(value ?? '').trim();
    if (trimmed === '') return '';
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
    // Discord snowflakes exceed JavaScript's safe integer range. Keep long
    // integer-looking values as strings so role/user/channel IDs are exact.
    if (/^\d{16,}$/.test(trimmed)) return trimmed;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (trimmed.includes(',')) return trimmed.split(',').map(item => item.trim()).filter(Boolean);
    return trimmed;
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`Aether configuration is missing: ${CONFIG_PATH}`);
    }
    const values = {};
    for (const rawLine of fs.readFileSync(CONFIG_PATH, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) throw new Error(`Invalid Aether.env line: ${rawLine}`);
        const key = line.slice(0, separator).trim();
        if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid Aether.env key: ${key}`);
        values[key] = parseValue(line.slice(separator + 1));
    }
    return Object.freeze(values);
}

function getConfig() {
    if (!cached) cached = loadConfig();
    return cached;
}

function reloadConfig() {
    cached = loadConfig();
    return cached;
}

function asList(value) {
    return (Array.isArray(value) ? value : String(value || '').split(','))
        .map(item => String(item).trim()).filter(Boolean);
}

function maxRounds(series) {
    const config = getConfig();
    return Number(config[`SERIES_MAX_ROUNDS_${String(series || 'F1').toUpperCase()}`] || 12);
}

function reductions() {
    const config = getConfig();
    return Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
        const position = index + 1;
        return [position, Number(config[`QUALIFYING_REDUCTION_P${position}`] || 0)];
    }));
}

module.exports = { CONFIG_PATH, getConfig, reloadConfig, asList, maxRounds, reductions };

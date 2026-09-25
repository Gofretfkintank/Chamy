#!/usr/bin/env node
/*
 * Non-destructive Aether SQLite -> Chamy Mongo migration.
 *
 * Usage:
 *   node services/aether/migrate.js --sqlite ../Aether/Aether-main/data.db --guild-id 123 --dry-run
 *   MONGO_URI=... node services/aether/migrate.js --sqlite ... --guild-id 123
 *
 * The SQLite reader uses Python's standard sqlite3 module, so this migration
 * does not add a runtime dependency to Chamy. Every write is keyed by
 * (guildId, legacyId), making reruns idempotent. Existing Mongo documents are
 * never deleted or overwritten except for the first import of that key.
 */
const { spawnSync } = require('child_process');
const path = require('path');

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sqlitePath = path.resolve(arg('--sqlite', path.resolve(__dirname, '../../../Aether/Aether-main/data.db')));
const guildId = String(arg('--guild-id', process.env.AETHER_MIGRATION_GUILD_ID || '')).trim();
const apply = process.argv.includes('--apply');
const dryRun = !apply;
if (!guildId) {
    console.error('Missing --guild-id (SQLite has no guild on profiles, so the target guild must be explicit).');
    process.exit(2);
}

const py = String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1]); db.row_factory = sqlite3.Row
tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
def rows(table):
    return [dict(r) for r in db.execute("select * from " + table)] if table in tables else []
print(json.dumps({t: rows(t) for t in ("user_profiles","sessions","submissions","penalties","qualifying_results")}, default=str))
`;
const read = spawnSync('python3', ['-c', py, sqlitePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (read.status !== 0) throw new Error(read.stderr || 'Could not read SQLite database');
const source = JSON.parse(read.stdout);
const count = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v.length]));
console.log(`[AETHER MIGRATION] source=${sqlitePath} guild=${guildId} dryRun=${dryRun}`, count);
if (dryRun) {
    console.log('[AETHER MIGRATION] read-only mode; pass --apply to write Mongo.');
    process.exit(0);
}
if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required unless --dry-run is used');
const mongoose = require('mongoose');
const {
    AetherSession, AetherProfile, AetherSubmission, AetherLicenseKey,
    AetherQualifyingResult, AetherLegacyPenalty, upsertCentral
} = require('./index');
const Sanction = require('../../models/Sanction');

function dateFromUnix(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : undefined;
}
async function upsert(Model, legacyId, data) {
    return Model.findOneAndUpdate(
        { guildId, legacyId: Number(legacyId) },
        { $setOnInsert: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
}
async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const profileByKey = new Map();
    const sessionById = new Map();
    let imported = 0;
    for (const p of source.user_profiles) {
        const doc = await upsert(AetherProfile, p.id, {
            guildId, legacyId: p.id, discordUserId: String(p.discord_user_id),
            discordUsername: p.discord_username || '', licenseKey: String(p.license_key).toUpperCase(),
            name: p.name, driverNumber: p.driver_number, nationality: p.nationality || '',
            team: p.team || '', currentTeam: p.current_team || '', series: p.series || 'F1',
            createdAt: dateFromUnix(p.created_at), updatedAt: dateFromUnix(p.updated_at)
        });
        profileByKey.set(String(p.license_key).toUpperCase(), doc);
        await upsertCentral('profile', doc._id, doc.toObject(), { guildId });
        await AetherLicenseKey.updateOne(
            { guildId, licenseKey: String(p.license_key).toUpperCase() },
            { $setOnInsert: { guildId, licenseKey: String(p.license_key).toUpperCase(), profileId: doc._id } },
            { upsert: true }
        );
        imported++;
    }
    for (const s of source.sessions) {
        const doc = await upsert(AetherSession, s.id, {
            guildId, legacyId: s.id, channelId: s.channel_id ? String(s.channel_id) : undefined,
            raceCountry: s.race_country || '', raceFlag: s.race_flag || '', roundNumber: s.round_number,
            series: s.series || 'F1', sessionType: s.session_type || 'RACE',
            startTs: s.start_ts || 0, endTs: s.end_ts || 0, weather: s.weather || 'DRY',
            quietMode: !!s.quiet_mode, status: s.closed ? 'ENDED' : 'SCHEDULED',
            completedAt: s.closed ? (dateFromUnix(s.closed_at) || dateFromUnix(s.end_ts)) : undefined,
            createdAt: dateFromUnix(s.created_at)
        });
        sessionById.set(Number(s.id), doc);
        await upsertCentral('session', doc._id, doc.toObject(), { guildId, sessionId: doc._id });
        imported++;
    }
    for (const s of source.submissions) {
        const session = sessionById.get(Number(s.session_id));
        if (!session) { console.warn(`[AETHER MIGRATION] submission ${s.id} skipped: missing session ${s.session_id}`); continue; }
        const submission = await upsert(AetherSubmission, s.id, {
            guildId, legacyId: s.id, legacySessionId: Number(s.session_id), sessionId: session._id,
            licenseKey: String(s.license_key).toUpperCase(), lapTimeCs: s.lap_time_cs,
            lapTimeDisplay: s.lap_time_display, tyre: s.tyre || '', imageProofUrl: s.image_proof_path || '',
            videoProofUrl: s.video_proof_path || '', attempts: s.attempt_counter || 0,
            createdAt: dateFromUnix(s.created_at), updatedAt: dateFromUnix(s.updated_at),
            imageProofMeta: { legacyPath: s.image_proof_path || null },
            videoProofMeta: { legacyPath: s.video_proof_path || null }
        });
        await upsertCentral('submission', submission._id, submission.toObject(), { guildId, sessionId: session._id });
        imported++;
    }
    for (const q of source.qualifying_results) {
        const qualifying = await upsert(AetherQualifyingResult, q.id, {
            guildId, legacyId: q.id, roundNumber: q.round_number, series: q.series,
            raceCountry: q.race_country, sessionType: q.session_type || 'QUALIFYING',
            licenseKey: String(q.license_key).toUpperCase(), qualifyingPosition: q.qualifying_position,
            lapTimeCs: q.lap_time_cs, lapTimeDisplay: q.lap_time_display,
            createdAt: dateFromUnix(q.created_at), legacyData: q
        });
        await upsertCentral('qualifying_result', qualifying._id, qualifying.toObject(), { guildId });
        imported++;
    }
    for (const p of source.penalties) {
        const code = `LEG${String(p.id).padStart(5, '0')}`.slice(-8);
        await upsert(AetherLegacyPenalty, p.id, {
            guildId, legacyId: p.id, licenseKey: String(p.license_key).toUpperCase(),
            penaltySeconds: p.penalty_seconds, reason: p.reason || '', issuedBy: String(p.issued_by),
            issuedAt: dateFromUnix(p.issued_at), sessionId: p.session_id, submissionId: p.submission_id,
            legacyData: p
        });
        await Sanction.updateOne(
            { guildId, sanctionCode: code },
            { $setOnInsert: {
                guildId, sanctionCode: code, targetUserId: profileByKey.get(String(p.license_key).toUpperCase())?.discordUserId || '',
                sanctionType: 'TIME', penaltyCs: Number(p.penalty_seconds) * 100, reason: p.reason || '',
                createdBy: String(p.issued_by), createdAt: dateFromUnix(p.issued_at) || new Date(),
                expirationDays: 3650, expiresAt: new Date('9999-12-31T00:00:00.000Z'), status: 'COMPLETED'
            } }, { upsert: true }
        );
        imported++;
    }
    console.log(`[AETHER MIGRATION] complete; imported-or-existing=${imported}`);
    await mongoose.disconnect();
}
main().catch(async err => { console.error('[AETHER MIGRATION] failed:', err.stack || err); await mongoose.disconnect().catch(() => {}); process.exit(1); });

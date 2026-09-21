const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType,
} = require('discord.js');

const Driver       = require('../models/Driver');
const DriverRating = require('../models/DriverRating');
const Economy      = require('../models/Economy');
const Sponsor      = require('../models/Sponsor');
const { getSponsorById } = require('../data/sponsorCatalog');
const { CHAOS_POOL }     = require('./chaoscall');

const GP_REWARDS     = [25000, 18000, 15000, 12000, 10000, 8000, 6000, 4000, 2000, 1000];
const SPRINT_REWARDS = [8000,  7000,  6000,  5000,  4000,  3000, 2000, 1000];
const DNF_REWARD     = 0;

function applyChaosModifier(baseRewards, count, modifier) {
    const slice = Array.from({ length: count }, (_, i) => baseRewards[i] ?? 0);
    switch (modifier.type) {
        case 'multiply':    return slice.map(v => Math.floor(v * modifier.value));
        case 'reverse':     return [...slice].reverse();
        case 'flat':        return slice.map(() => modifier.value);
        case 'zero_winner': return slice.map((v, i) => (i === 0 ? 0 : v));
        case 'podium_only': return slice.map((v, i) => (i < 3 ? v * 3 : 0));
        case 'zero_all':    return slice.map(() => 0);
        default:            return slice;
    }
}

async function getDriver(userId, guild) {
    let driver = await Driver.findOne({ userId });
    if (!driver) {
        let username = '';
        try {
            const member = guild?.members?.cache?.get(userId)
                || await guild?.members?.fetch(userId).catch(() => null);
            username = member?.user?.username || '';
        } catch { username = ''; }
        driver = await Driver.create({ userId, username });
        const existing = await DriverRating.findOne({ userId });
        if (!existing) await DriverRating.create({ userId, username });
    }
    return driver;
}

async function getWallet(userId) {
    let wallet = await Economy.findOne({ userId });
    if (!wallet) wallet = new Economy({ userId });
    return wallet;
}

function parseIds(input, interaction) {
    if (!input) return [];
    const words = input.split(/[\s,]+/);
    const ids = [];
    for (const word of words) {
        const cleaned = word.replace(/[<@!>]/g, '').trim();
        if (/^\d+$/.test(cleaned)) { ids.push(cleaned); continue; }
        const member = interaction.guild.members.cache.find(m =>
            m.user.username.toLowerCase() === cleaned.toLowerCase() ||
            m.displayName.toLowerCase() === cleaned.toLowerCase()
        );
        if (member) ids.push(member.id);
    }
    return ids;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('results')
        .setDescription('Post race results, update statistics, and distribute coins')
        .setDefaultMemberPermissions(0n)
        .addStringOption(opt =>
            opt.setName('track').setDescription('Track name').setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('race_type')
                .setDescription('Race type')
                .setRequired(true)
                .addChoices(
                    { name: 'Grand Prix', value: 'gp' },
                    { name: 'Sprint',     value: 'sprint' }
                )
        )
        .addUserOption(opt => opt.setName('p1').setDescription('1st Place').setRequired(true))
        .addUserOption(opt => opt.setName('p2').setDescription('2nd Place'))
        .addUserOption(opt => opt.setName('p3').setDescription('3rd Place'))
        .addUserOption(opt => opt.setName('p4').setDescription('4th Place'))
        .addUserOption(opt => opt.setName('p5').setDescription('5th Place'))
        .addUserOption(opt => opt.setName('p6').setDescription('6th Place'))
        .addUserOption(opt => opt.setName('p7').setDescription('7th Place'))
        .addUserOption(opt => opt.setName('p8').setDescription('8th Place'))
        .addUserOption(opt => opt.setName('p9').setDescription('9th Place'))
        .addUserOption(opt => opt.setName('p10').setDescription('10th Place'))
        .addUserOption(opt => opt.setName('p11').setDescription('11th Place'))
        .addUserOption(opt => opt.setName('p12').setDescription('12th Place'))
        .addUserOption(opt => opt.setName('p13').setDescription('13th Place'))
        .addUserOption(opt => opt.setName('p14').setDescription('14th Place'))
        .addUserOption(opt => opt.setName('p15').setDescription('15th Place'))
        .addUserOption(opt => opt.setName('p16').setDescription('16th Place'))
        .addStringOption(opt =>
            opt.setName('p17_p20')
                .setDescription('P17–P20: @mention or ID in order, space/comma separated')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('dnf').setDescription('DNF drivers (@user, ID, or username)')
        )
        .addStringOption(opt =>
            opt.setName('dns').setDescription('DNS drivers (@user, ID, or username)')
        )
        .addStringOption(opt =>
            opt.setName('comments').setDescription('Race comments')
        )
        .addRoleOption(opt =>
            opt.setName('ping_role')
                .setDescription('Role to ping in the results post (leave empty for no ping)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.channel) return;

        // ── Permission check — Admin veya Mod rolleri ──────────────────────
        const hasAccess =
            interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            MOD_ROLE_IDS.some(id => interaction.member.roles.cache.has(id));

        if (!hasAccess) {
            return interaction.reply({
                content: '❌ Bu komutu kullanmak için yetkin yok.',
                ephemeral: true,
            });
        }
        // ───────────────────────────────────────────────────────────────────

        await interaction.deferReply({ ephemeral: true });

        const track    = interaction.options.getString('track');
        const raceType = interaction.options.getString('race_type');
        const comments = interaction.options.getString('comments');
        const pingRole = interaction.options.getRole('ping_role');

        const isGP     = raceType === 'gp';
        const isSprint = raceType === 'sprint';

        const participants = [];
        for (let i = 1; i <= 16; i++) {
            const user = interaction.options.getUser(`p${i}`);
            if (user) participants.push(user);
        }

        const p17to20raw   = interaction.options.getString('p17_p20');
        const p17to20Ids   = parseIds(p17to20raw, interaction);
        const p17to20Users = [];
        for (const id of p17to20Ids) {
            try {
                const member = interaction.guild.members.cache.get(id)
                    || await interaction.guild.members.fetch(id).catch(() => null);
                if (member) p17to20Users.push(member.user);
            } catch { /* skip unresolvable */ }
        }

        const dnfList = parseIds(interaction.options.getString('dnf'), interaction);
        const dnsList = parseIds(interaction.options.getString('dns'), interaction);

        const totalFinishers = participants.length + p17to20Users.length;

        const chaosOptions = CHAOS_POOL
            .filter(c => c.affectsResults)
            .slice(0, 24)
            .map(c => ({
                label: `#${c.id} — ${c.title}`.slice(0, 100),
                description: c.category.slice(0, 100),
                value: String(c.id),
            }));

        const extrasRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('extra_none')
                .setLabel('✅ Post results now')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('extra_midseason')
                .setLabel('📅 Mid-Season')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('extra_chaos')
                .setLabel('⚡ Chaos Call')
                .setStyle(ButtonStyle.Danger),
        );

        const followUpMsg = await interaction.editReply({
            content: [
                `## ⚙️ Extras — **${track}** (${isGP ? 'Grand Prix' : 'Sprint'})`,
                `${totalFinishers} finisher(s) entered. Anything extra before posting?`,
            ].join('\n'),
            components: [extrasRow],
        });

        let isMidSeason = false;
        let chaosId     = null;

        await new Promise((resolve) => {
            const btnCollector = followUpMsg.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i => i.user.id === interaction.user.id,
                time: 60_000,
                max: 1,
            });

            btnCollector.on('collect', async (btnInt) => {
                await btnInt.deferUpdate();

                if (btnInt.customId === 'extra_midseason') {
                    isMidSeason = true;
                    await interaction.editReply({
                        content: `📅 **Mid-Season** confirmed — stats will NOT be recorded.\n⏳ Processing results...`,
                        components: [],
                    });
                    resolve();

                } else if (btnInt.customId === 'extra_chaos') {
                    const chaosRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('chaos_select')
                            .setPlaceholder('Select the active Chaos Call...')
                            .addOptions(chaosOptions)
                    );
                    await interaction.editReply({
                        content: `⚡ Select the active **Chaos Call**:`,
                        components: [chaosRow],
                    });

                    try {
                        const selectInt = await followUpMsg.awaitMessageComponent({
                            componentType: ComponentType.StringSelect,
                            filter: i => i.user.id === interaction.user.id,
                            time: 30_000,
                        });
                        await selectInt.deferUpdate();
                        chaosId = parseInt(selectInt.values[0], 10);
                        await interaction.editReply({
                            content: `⚡ **Chaos Call #${chaosId}** selected.\n⏳ Processing results...`,
                            components: [],
                        });
                    } catch {
                        await interaction.editReply({
                            content: `⏱️ Chaos selection timed out — posting without chaos.`,
                            components: [],
                        });
                    }
                    resolve();

                } else {
                    await interaction.editReply({
                        content: `✅ No extras.\n⏳ Processing results...`,
                        components: [],
                    });
                    resolve();
                }
            });

            btnCollector.on('end', (_col, reason) => {
                if (reason === 'time') {
                    interaction.editReply({
                        content: `⏱️ Timed out — posting results without extras.`,
                        components: [],
                    }).catch(() => {});
                }
                resolve();
            });
        });

        const chaos = chaosId ? CHAOS_POOL.find(c => c.id === chaosId) : null;
        let rewards = isGP ? [...GP_REWARDS] : [...SPRINT_REWARDS];

        const allFinishers = [...participants, ...p17to20Users];

        if (chaos?.affectsResults === 'auto' && chaos.modifier) {
            rewards = applyChaosModifier(rewards, allFinishers.length, chaos.modifier);
        }

        const participantIds = allFinishers.map(p => String(p.id));
        const coinLog = [];

        for (const [index, user] of allFinishers.entries()) {
            const driver = await getDriver(user.id, interaction.guild);
            const wallet = await getWallet(user.id);

            if (!isMidSeason) {
                if (isGP) driver.races++;
                if (index === 0) {
                    if (isGP)     driver.wins++;
                    if (isSprint) driver.poles++;
                }
                if (isGP && index <= 2) driver.podiums++;

                if (!driver.raceHistory) driver.raceHistory = [];
                driver.raceHistory.push({ pos: index + 1, type: raceType, date: new Date() });
                if (driver.raceHistory.length > 10) driver.raceHistory.shift();

                await driver.save();
            }

            let earned  = rewards[index] ?? 0;
            let boosted = false;
            if (earned > 0 && wallet.raceBoost) {
                earned = Math.floor(earned * 1.5);
                wallet.raceBoost = false;
                boosted = true;
            }
            if (earned > 0) {
                await wallet.addCoins(earned);
                coinLog.push({ user, pos: index + 1, coins: earned, boosted });
            }

            if (chaos?.modifier?.type !== 'zero_all') {
                const sponsorRec = await Sponsor.findOne({ userId: user.id });
                if (sponsorRec?.activeSponsorId) {
                    const sponsor = getSponsorById(sponsorRec.activeSponsorId);
                    if (sponsor) {
                        let sponsorEarned = 0;
                        if (isGP) {
                            sponsorEarned += sponsor.basePerRace;
                            if (index === 0)     sponsorEarned += sponsor.winBonus;
                            else if (index <= 2) sponsorEarned += sponsor.podiumBonus;
                        }
                        if (isSprint && index === 0) sponsorEarned += sponsor.sprintBonus;

                        if (sponsorEarned > 0) {
                            await wallet.addCoins(sponsorEarned);
                            sponsorRec.racesWithSponsor   = (sponsorRec.racesWithSponsor   || 0) + (isGP ? 1 : 0);
                            sponsorRec.totalSponsorEarned = (sponsorRec.totalSponsorEarned || 0) + sponsorEarned;
                            await sponsorRec.save();
                            coinLog.push({ user, pos: index + 1, coins: sponsorEarned, isSponsor: true, sponsorName: sponsor.name });
                        }
                    }
                }
            }
        }

        const dnfReward = chaos?.modifier?.type === 'zero_all' ? 0 : DNF_REWARD;

        for (const id of dnfList) {
            const driver = await getDriver(id, interaction.guild);
            if (!isMidSeason) {
                driver.dnf++;
                if (!participantIds.includes(id) && isGP) driver.races++;
                if (!driver.raceHistory) driver.raceHistory = [];
                driver.raceHistory.push({ pos: 99, type: raceType, date: new Date() });
                if (driver.raceHistory.length > 10) driver.raceHistory.shift();
                await driver.save();
            }
            if (dnfReward > 0) {
                const wallet = await getWallet(id);
                await wallet.addCoins(dnfReward);
                coinLog.push({ userId: id, pos: 'DNF', coins: dnfReward });
            }
            if (!isMidSeason && isGP) {
                const sponsorRec = await Sponsor.findOne({ userId: id });
                if (sponsorRec?.activeSponsorId) {
                    sponsorRec.racesWithSponsor = (sponsorRec.racesWithSponsor || 0) + 1;
                    await sponsorRec.save();
                }
            }
        }

        for (const id of dnsList) {
            if (!isMidSeason) {
                const driver = await getDriver(id, interaction.guild);
                driver.dns++;
                await driver.save();
            }
        }

        const seasonTag = isMidSeason ? ' *(Mid-Season — stats not recorded)*' : '';
        const raceLabel = isGP ? 'GRAND PRIX' : 'SPRINT';
        let msg = `# ${track.toUpperCase()} — ${raceLabel}${seasonTag}\n\n`;

        if (chaos) {
            if (chaos.affectsResults === 'auto') {
                msg += `⚡ **Chaos Call #${chaos.id} — ${chaos.title}** *(applied automatically)*\n\n`;
            } else if (chaos.affectsResults === 'manual') {
                msg += `⚠️ **Chaos Call #${chaos.id} — ${chaos.title}** *(manual adjustment required)*\n`;
                msg += `> ${chaos.manualNote}\n\n`;
            }
        }

        allFinishers.forEach((user, i) => {
            const log = coinLog.find(c => c.user?.id === user.id && !c.isSponsor);
            const rewardStr = log
                ? ` *(+${log.coins} 🪙${log.boosted ? ' 🚀' : ''})*`
                : chaos?.modifier?.type === 'zero_all' ? ' *(Glory only 🏆)*' : '';
            msg += `P${i + 1}: ${user}${i === 0 && isSprint ? ' ⏱️ (POLE)' : ''}${rewardStr}\n`;
        });

        let lastPos = allFinishers.length;
        for (const id of dnfList) {
            lastPos++;
            const dnfStr = dnfReward > 0 ? ` *(+${dnfReward} 🪙)*` : '';
            msg += `P${lastPos}: <@${id}> (DNF)${dnfStr}\n`;
        }
        for (const id of dnsList) {
            lastPos++;
            msg += `P${lastPos}: <@${id}> (DNS)\n`;
        }

        if (comments) msg += `\n**Comments:**\n${comments}\n`;
        if (pingRole)  msg += `\n${pingRole}`;

        await interaction.channel.send({ content: msg });
        await interaction.editReply({
            content: `✅ Results posted successfully!`,
            components: [],
        });
    },
};
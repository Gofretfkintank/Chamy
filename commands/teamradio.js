// commands/teamradio.js
const {
    SlashCommandBuilder,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const TeamRadio = require('../models/TeamRadio');
const cfg = require('../lib/guildConfig');
const { LEGACY_GUILD_ID } = require('../lib/legacySeed');

//--------------------------------------------------
// CONFIG
//--------------------------------------------------

const TEAMS = [
    "BMW Racing",
    "Stuttgart-Silver Racing",
    "WRT BMW",
    "Iron Dames",
    "Aston Martin AMR",
    "Verstappen.com Racing",
    "Falken Tyres GT3",
    "Mid-Night Racing",
    "Manthey Racing"
];

// The category comes from the home guild's config (categories:teamRadio).
const DELETE_AFTER_MS = 60 * 60 * 1000; // 1 saat

//--------------------------------------------------
// HELPERS
//--------------------------------------------------

function slugify(name) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function buildPanelEmbed(record) {
    const fiaStatus = record.fiaVisible
        ? '🟢 **FIA Access: ON** — Stewards can currently see this channel.'
        : '🔴 **FIA Access: OFF** — Stewards cannot see this channel.';

    return new EmbedBuilder()
        .setColor(0xE8000D)
        .setTitle('📡 Team Radio — Secure Channel')
        .setDescription(
            `> *This channel is restricted to **${record.teamName}** members only.*\n\n` +
            `Opened by <@${record.openerId}>.\n\n` +
            fiaStatus
        )
        .addFields(
            { name: '🏎️ Team',      value: record.teamName,         inline: true },
            { name: '👤 Opened by', value: `<@${record.openerId}>`, inline: true },
            { name: '📋 Rules',     value: 'Keep communication professional. Use the FIA toggle to invite stewards if needed.' }
        )
        .setFooter({ text: 'Olzhasstik Motorsports — Team Radio System' })
        .setTimestamp();
}

function buildClosedEmbed(userId) {
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔒 Channel Closed')
        .setDescription(
            `This radio channel was closed by <@${userId}>.\n\n` +
            `It will be **automatically deleted in 1 hour**.\n` +
            `Use **Reopen** to restore access before then.`
        )
        .setTimestamp();
}

function buildControlRow(closed = false, fiaVisible = false) {
    return new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId('radio_close')
            .setLabel(closed ? 'Already Closed' : 'Close Channel')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(closed),

        new ButtonBuilder()
            .setCustomId('radio_reopen')
            .setLabel('Reopen Channel')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!closed),

        // Takım üyeleri toggle eder — FIA'yı çağır / gönder
        new ButtonBuilder()
            .setCustomId('radio_fia_toggle')
            .setLabel(fiaVisible ? 'Dismiss FIA' : 'Call FIA')
            .setEmoji('👁️')
            .setStyle(fiaVisible ? ButtonStyle.Secondary : ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('radio_refresh')
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
    );
}

//--------------------------------------------------
// FIA PERMISSION OVERWRITES
// FIA = Administrator yetkisi olan roller
// Owner zaten her şeyi görür, ona dokunmuyoruz
//--------------------------------------------------

async function setFiaAccess(channel, guild, visible) {
    // Administrator yetkili tüm rolleri bul (owner hariç — o zaten görür)
    const fiaRoles = guild.roles.cache.filter(r =>
        r.permissions.has(PermissionFlagsBits.Administrator) &&
        r.id !== guild.id // @everyone'ı atla
    );

    for (const [, role] of fiaRoles) {
        if (visible) {
            await channel.permissionOverwrites.edit(role.id, {
                ViewChannel:        true,
                ReadMessageHistory: true,
                SendMessages:       false  // görebilir ama yazamaz
            });
        } else {
            // Overwrite'ı tamamen kaldır — kanal seviyesinde default deny devreye girer
            await channel.permissionOverwrites.delete(role.id).catch(() => {});
        }
    }
}

//--------------------------------------------------
// RESTART-SAFE DELETE SCHEDULER
//--------------------------------------------------

async function scheduleDelete(client, record) {
    const elapsed   = Date.now() - new Date(record.closedAt).getTime();
    const remaining = DELETE_AFTER_MS - elapsed;

    const doDelete = async () => {
        const ch = client.channels.cache.get(record.channelId);
        if (ch) await ch.delete().catch(() => {});
        await TeamRadio.deleteOne({ channelId: record.channelId });
    };

    if (remaining <= 0) {
        await doDelete();
    } else {
        setTimeout(doDelete, remaining);
    }
}

//--------------------------------------------------
// STARTUP — index.js ready event'ine ekle:
//   const { onStartup } = require('./commands/teamradio');
//   await onStartup(client);
//--------------------------------------------------

async function onStartup(client) {
    try {
        const closed = await TeamRadio.find({ closed: true, closedAt: { $ne: null } });
        for (const record of closed) {
            await scheduleDelete(client, record);
        }
        console.log(`📡 [TeamRadio] ${closed.length} kapatılmış kanal restart sonrası zamanlandı.`);
    } catch (err) {
        console.error('[TeamRadio] Startup error:', err);
    }
}

//--------------------------------------------------
// EXPORT
//--------------------------------------------------

module.exports = {
    onStartup,

    data: new SlashCommandBuilder()
        .setName('teamradio')
        .setDescription('Open a private team radio channel for your team'),

    //--------------------------------------------------
    // EXECUTE
    //--------------------------------------------------

    async execute(interaction) {
        // Home server only. The team list is OM's teams, and a radio record is
        // looked up by team NAME with no guild attached — in a second server, a
        // role that happens to be called "BMW Racing" would find OM's open
        // channel, fail to see it, and delete OM's record.
        if (interaction.guildId !== LEGACY_GUILD_ID) {
            return interaction.reply({
                content: '❌ Team radio is only available in the OM server.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const member = interaction.member;
        const guild  = interaction.guild;

        const categoryId = await cfg.get(guild.id, 'categories:teamRadio');
        if (!categoryId) {
            return interaction.editReply({
                content: '❌ No team radio category is set. An admin can set one with `/config set-channel key:categories:teamRadio`.'
            });
        }

        const teamRole = member.roles.cache.find(r => TEAMS.includes(r.name));

        if (!teamRole) {
            return interaction.editReply({
                content: '❌ You do not have a valid team role. Contact staff if this is a mistake.'
            });
        }

        // DB'de bu takımın açık kanalı var mı?
        const existingRecord = await TeamRadio.findOne({ teamName: teamRole.name, closed: false });

        if (existingRecord) {
            const existingChannel = guild.channels.cache.get(existingRecord.channelId);
            if (existingChannel) {
                return interaction.editReply({
                    content: `📡 Your team already has an active radio channel: ${existingChannel}`
                });
            }
            // Discord'da kanal yok ama DB'de kalmış — temizle
            await TeamRadio.deleteOne({ _id: existingRecord._id });
        }

        // Kanal oluştur
        // FIA (admin roller) başlangıçta göremez — everyone deny + sadece takım rolü allow
        const channel = await guild.channels.create({
            name: `radio-${slugify(teamRole.name)}`,
            type: ChannelType.GuildText,
            parent: CATEGORY_ID,
            topic: `Team Radio | ${teamRole.name} | Opened by ${member.user.tag}`,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: teamRole.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
                // Admin rollere explicit overwrite YOK → everyone deny geçerli → göremezler
                // Owner zaten guild owner olduğu için Discord her şeyi görür — ek overwrite gerekmez
            ]
        });

        // DB kaydı
        const radioRecord = await TeamRadio.create({
            channelId:  channel.id,
            teamName:   teamRole.name,
            openerTag:  member.user.tag,
            openerId:   member.user.id,
            fiaVisible: false,
            closed:     false,
        });

        // Panel gönder
        const msg = await channel.send({
            embeds: [buildPanelEmbed(radioRecord)],
            components: [buildControlRow(false, false)]
        });

        // messageId'yi sakla
        radioRecord.messageId = msg.id;
        await radioRecord.save();

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Team Radio Opened')
                    .setDescription(`Your team channel is ready: ${channel}`)
                    .setFooter({ text: 'FIA stewards cannot see this channel by default.' })
                    .setTimestamp()
            ]
        });
    },

    //--------------------------------------------------
    // BUTTON HANDLER
    //--------------------------------------------------

    async buttonHandler(interaction) {
        const channel = interaction.channel;
        const guild   = interaction.guild;

        if (channel.parentId !== CATEGORY_ID) return;

        const record = await TeamRadio.findOne({ channelId: channel.id });
        if (!record) {
            return interaction.reply({ content: '❌ No radio record found for this channel.', ephemeral: true });
        }

        //--------------------------------------------
        // REFRESH — herkes kullanabilir
        //--------------------------------------------

        if (interaction.customId === 'radio_refresh') {
            const embed = record.closed
                ? buildClosedEmbed(interaction.user.id)
                : buildPanelEmbed(record);
            const row = buildControlRow(record.closed, record.fiaVisible);
            return interaction.update({ embeds: [embed], components: [row] });
        }

        //--------------------------------------------
        // FIA TOGGLE — takım üyeleri kullanır
        //--------------------------------------------

        if (interaction.customId === 'radio_fia_toggle') {
            // Sadece bu kanalın takım rolüne sahip olanlar kullanabilir
            const member   = interaction.member;
            const teamRole = guild.roles.cache.find(r => r.name === record.teamName);

            if (!teamRole || !member.roles.cache.has(teamRole.id)) {
                return interaction.reply({
                    content: '❌ Only team members can control FIA access.',
                    ephemeral: true
                });
            }

            const newState = !record.fiaVisible;
            record.fiaVisible = newState;
            await record.save();

            await setFiaAccess(channel, guild, newState);

            const embed = buildPanelEmbed(record);
            const row   = buildControlRow(record.closed, newState);
            return interaction.update({ embeds: [embed], components: [row] });
        }

        //--------------------------------------------
        // CLOSE
        //--------------------------------------------

        if (interaction.customId === 'radio_close') {
            if (record.closed) {
                return interaction.reply({ content: '❌ Channel is already closed.', ephemeral: true });
            }

            const teamRole = guild.roles.cache.find(r => r.name === record.teamName);
            if (teamRole) {
                await channel.permissionOverwrites.edit(teamRole.id, { SendMessages: false });
            }

            record.closed   = true;
            record.closedAt = new Date();
            await record.save();

            await interaction.update({
                embeds: [buildClosedEmbed(interaction.user.id)],
                components: [buildControlRow(true, record.fiaVisible)]
            });

            setTimeout(async () => {
                await channel.delete().catch(() => {});
                await TeamRadio.deleteOne({ channelId: channel.id });
            }, DELETE_AFTER_MS);

            return;
        }

        //--------------------------------------------
        // REOPEN
        //--------------------------------------------

        if (interaction.customId === 'radio_reopen') {
            if (!record.closed) {
                return interaction.reply({ content: '❌ Channel is already open.', ephemeral: true });
            }

            const teamRole = guild.roles.cache.find(r => r.name === record.teamName);
            if (teamRole) {
                await channel.permissionOverwrites.edit(teamRole.id, { SendMessages: true });
            }

            record.closed   = false;
            record.closedAt = null;
            await record.save();

            await interaction.update({
                embeds: [buildPanelEmbed(record)],
                components: [buildControlRow(false, record.fiaVisible)]
            });

            return;
        }
    }
};

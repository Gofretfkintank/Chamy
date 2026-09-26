// commands/verify.js
//
// Sets up a verification gate in the channel this command is run in:
//   - Creates a "👤┃Member" role (baby blue, hoisted) if it doesn't exist yet
//   - Hides @everyone's view of every OTHER channel (unless already private)
//   - Grants the new role explicit view access to everything it just hid,
//     so verified members see exactly what they'd normally see
//   - Posts an embed + Verify button in this channel
//
// Clicking the button hands out the role. Channels that already had
// @everyone explicitly denied (own overwrite OR inherited from their
// category) are left completely untouched — this only gates channels
// that were previously open to everyone.

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const crypto = require('crypto');
const captcha = require('../lib/captcha');

const GuildConfig = require('../models/GuildConfig');

const MEMBER_ROLE_NAME  = '👤┃Member';
const MEMBER_ROLE_COLOR = '#89CFF0'; // baby blue

//--------------------------------------------------
// HELPERS
//--------------------------------------------------

function buildVerifyEmbed(guildName) {
    return new EmbedBuilder()
        .setColor(0x89CFF0)
        .setTitle('🔐 Server Verification')
        .setDescription(
            `Welcome to **${guildName}**!\n\n` +
            `Click **Verify** below, then type the code from the image to confirm you're human ` +
            `and unlock access to the rest of the server.`
        )
        .setFooter({ text: 'Chamy — Verification' })
        .setTimestamp();
}

function buildVerifyRow(roleId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_claim_${roleId}`)
            .setLabel('Verify')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
    );
}

// True if @everyone effectively can't see this channel — checked via the
// FULLY RESOLVED permission (base role perms + category + channel
// overwrites), not just an explicit deny overwrite. Catches channels
// hidden because @everyone's base role lacks ViewChannel, which the old
// overwrite-only check missed — that bug caused /verify to grant the new
// Member role view access to genuinely private (admin-only) channels.
function everyoneAlreadyDenied(channel, everyoneRole) {
    const resolved = channel.permissionsFor(everyoneRole);
    return !resolved || !resolved.has(PermissionFlagsBits.ViewChannel);
}

//--------------------------------------------------
// EXPORT
//--------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Set up the server verification gate in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(o => o.setName('role')
            .setDescription('Use this existing role instead of creating "Member" — e.g. a VSR role.')
            .setRequired(false)),

    //--------------------------------------------------
    // EXECUTE
    //--------------------------------------------------

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Hard in-code gate: setDefaultMemberPermissions is only a Discord-side
        // default that server admins can override in Integrations settings, and
        // some clients show restricted commands anyway. This check runs on OUR
        // side on every invocation — non-admins get rejected no matter what.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ This command is **admin-only**.');
        }

        const guild       = interaction.guild;
        const gateChannel = interaction.channel;
        const everyoneId  = guild.roles.everyone.id;
        const me          = guild.members.me;

        if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply('❌ I need **Manage Roles** and **Manage Channels** permission to set this up.');
        }

        // 1. Use the given role if one was passed; otherwise find or create the
        //    default Member role, same as before.
        const providedRole = interaction.options.getRole('role');
        let memberRole = providedRole;
        let roleWasCreated = false;
        if (!memberRole) {
            memberRole = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
            if (!memberRole) {
                memberRole = await guild.roles.create({
                    name: MEMBER_ROLE_NAME,
                    color: MEMBER_ROLE_COLOR,
                    hoist: true,
                    reason: 'OM Verify system setup'
                });
                roleWasCreated = true;
            }
        }

        if (memberRole.position >= me.roles.highest.position) {
            return interaction.editReply(
                `⚠️ I created/found **${memberRole.name}**, but it sits **above or equal to** my highest role, ` +
                `so I won't be able to hand it out. Move my role above it in Server Settings → Roles, then run **/verify** again ` +
                `or just have people click the button once it's fixed.`
            );
        }

        // 2. Remember the setup in GuildConfig (per-guild, upsert)
        await GuildConfig.findOneAndUpdate(
            { guildId: guild.id },
            { verifyRoleId: memberRole.id, verifyChannelId: gateChannel.id },
            { upsert: true }
        ).catch(() => {});

        // 3. Guarantee the gate channel itself stays visible to @everyone,
        //    even if its category ends up locked below.
        await gateChannel.permissionOverwrites.edit(everyoneId, { ViewChannel: true })
            .catch(err => console.error('[VERIFY] Could not open the gate channel to @everyone:', err.message));

        // 4. Sweep every other channel/category
        let locked = 0, skipped = 0, failed = 0;

        for (const channel of guild.channels.cache.values()) {
            if (channel.id === gateChannel.id) continue;

            try {
                if (everyoneAlreadyDenied(channel, guild.roles.everyone)) {
                    skipped++;
                    continue;
                }
                await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false });
                await channel.permissionOverwrites.edit(memberRole.id, { ViewChannel: true });
                locked++;
            } catch (err) {
                failed++;
                console.error(`[VERIFY] ${channel.name}:`, err.message);
            }
        }

        // Before posting: confirm *I* can actually see and send here. Granting
        // @everyone view access (step 3) says nothing about my own role — a
        // channel-level (or category-inherited) deny on the bot's role still
        // wins, and that is exactly what produced the "Missing Access" crash
        // this replaces: a private gate channel where the bot's role was never
        // granted View Channel / Send Messages.
        const myGatePerms = gateChannel.permissionsFor(me);
        if (!myGatePerms?.has(PermissionFlagsBits.ViewChannel) || !myGatePerms?.has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply(
                `⚠️ Locked **${locked}** channel(s) and set up ${memberRole}, but I don't have permission to post ` +
                `in ${gateChannel} myself. Give my role **View Channel** and **Send Messages** there (or on its category), ` +
                `then run **/verify** again to post the panel.`
            );
        }

        // 5. Post the public verify panel in the gate channel
        try {
            await gateChannel.send({
                embeds: [buildVerifyEmbed(guild.name)],
                components: [buildVerifyRow(memberRole.id)]
            });
        } catch (err) {
            console.error('[VERIFY] Failed to post the panel:', err.message);
            return interaction.editReply(
                `⚠️ Locked **${locked}** channel(s) and set up ${memberRole}, but posting the panel in ${gateChannel} ` +
                `failed: \`${err.message}\`. Fix my permissions there and run **/verify** again.`
            );
        }

        // 6. Confirm to the admin
        return interaction.editReply(
            `✅ Verification gate live in ${gateChannel}.\n\n` +
            `**Role:** ${memberRole}${roleWasCreated ? ' (created, baby blue, hoisted)' : ' (existing role)'}\n` +
            `🔒 **${locked}** channel(s) hidden from @everyone\n` +
            `⏭️ **${skipped}** channel(s) already private — left untouched\n` +
            (failed ? `⚠️ **${failed}** channel(s) failed — check my permissions there.\n` : '') +
            `\nNew channels created later won't auto-lock — say the word if you want that too.`
        );
    },

    //--------------------------------------------------
    // BUTTON HANDLER
    //   verify_claim_<roleId>  -> captcha gorseli gonder
    //   verify_new_<roleId>    -> yeni gorsel
    //   verify_code_<roleId>   -> kodu girme modalini ac
    //--------------------------------------------------

    async buttonHandler(interaction) {
        const id = interaction.customId;
        const roleId = id.replace(/^verify_(claim|new|code)_/, '');
        const key = `${interaction.guildId}:${interaction.user.id}`;

        if (id.startsWith('verify_code_')) {
            const p = pending.get(key);
            if (!p || p.expires < Date.now()) {
                pending.delete(key);
                return interaction.reply({ content: '⌛ That code expired. Press **Verify** again for a new one.', ephemeral: true });
            }
            const modal = new ModalBuilder()
                .setCustomId(`verify_modal_${roleId}`)
                .setTitle('Verification');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('code')
                    .setLabel(p.math ? 'Your answer' : 'Characters in the image')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(10)
                    .setRequired(true),
            ));
            return interaction.showModal(modal);
        }

        // claim / new: once rol ve durum kontrolleri.
        const problem = checkRole(interaction, roleId);
        if (problem) return interaction.reply({ content: problem, ephemeral: true });

        const until = cooldown.get(key);
        if (until && until > Date.now()) {
            const s = Math.ceil((until - Date.now()) / 1000);
            return interaction.reply({ content: `⏳ Too many wrong tries. Try again in **${s}s**.`, ephemeral: true });
        }

        return sendChallenge(interaction, roleId, id.startsWith('verify_new_'));
    },

    //--------------------------------------------------
    // MODAL HANDLER — verify_modal_<roleId>
    //--------------------------------------------------

    async modalHandler(interaction) {
        const roleId = interaction.customId.replace('verify_modal_', '');
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const p = pending.get(key);
        if (!p || p.expires < Date.now()) {
            pending.delete(key);
            return interaction.reply({ content: '⌛ That code expired. Press **Verify** again for a new one.', ephemeral: true });
        }

        const answer = interaction.fields.getTextInputValue('code').replace(/\s+/g, '').toUpperCase();
        if (answer !== p.code) {
            p.tries++;
            if (p.tries >= MAX_TRIES) {
                pending.delete(key);
                cooldown.set(key, Date.now() + COOLDOWN_MS);
                return interaction.reply({ content: `❌ Wrong again. Too many tries — wait **${COOLDOWN_MS / 60000} minutes** and press Verify.`, ephemeral: true });
            }
            return interaction.reply({
                content: `❌ Wrong code. **${MAX_TRIES - p.tries}** tries left — press **Enter code** again, or **New image** if it's hard to read.`,
                ephemeral: true,
            });
        }

        pending.delete(key);
        const problem = checkRole(interaction, roleId);
        if (problem) return interaction.reply({ content: problem, ephemeral: true });

        try {
            await interaction.member.roles.add(roleId, 'Passed /verify captcha');
            return interaction.reply({
                content: `✅ Verified! You now have access to **${interaction.guild.name}**.`,
                ephemeral: true,
            });
        } catch (err) {
            console.error('[VERIFY MODAL]', err.message);
            return interaction.reply({ content: '❌ Something went wrong assigning the role. Contact an admin.', ephemeral: true });
        }
    }
};

//--------------------------------------------------
// CAPTCHA STATE
//--------------------------------------------------

const pending = new Map();   // `${guildId}:${userId}` -> { code, math, expires, tries }
const cooldown = new Map();  // `${guildId}:${userId}` -> until
const CODE_TTL = 5 * 60 * 1000;
const MAX_TRIES = 3;
const COOLDOWN_MS = 2 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [k, p] of pending) if (p.expires < now) pending.delete(k);
    for (const [k, t] of cooldown) if (t < now) cooldown.delete(k);
}, 60_000).unref?.();

function checkRole(interaction, roleId) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return '❌ Verification role no longer exists — contact an admin.';
    if (interaction.member.roles.cache.has(roleId)) return '✅ You\'re already verified!';
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
        return '❌ I can\'t hand out this role right now — my role needs to be moved above it. Contact an admin.';
    }
    return null;
}

async function sendChallenge(interaction, roleId, isRefresh) {
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verify_code_${roleId}`).setLabel('Enter code').setEmoji('⌨️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`verify_new_${roleId}`).setLabel('New image').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    );

    let payload;
    try {
        const code = captcha.newCode();
        const png = captcha.render(code);
        pending.set(key, { code, math: false, expires: Date.now() + CODE_TTL, tries: 0 });
        payload = {
            content: 'Type the characters you see in the image (not case-sensitive). The code expires in 5 minutes.',
            files: [new AttachmentBuilder(png, { name: 'captcha.png' })],
            components: [row],
        };
    } catch {
        // Gorsel uretilemedi: matematik sorusuna dus.
        const a = crypto.randomInt(3, 20), b = crypto.randomInt(3, 20);
        pending.set(key, { code: String(a + b), math: true, expires: Date.now() + CODE_TTL, tries: 0 });
        payload = {
            content: `What is **${a} + ${b}**? Press **Enter code** and type the answer. Expires in 5 minutes.`,
            components: [row],
        };
    }

    if (isRefresh) return interaction.update({ ...payload, attachments: [] });
    return interaction.reply({ ...payload, ephemeral: true });
}

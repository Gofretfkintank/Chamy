const {
    SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType
} = require('discord.js');
const cfg = require('../lib/guildConfig');

function ok(desc)  { return new EmbedBuilder().setColor(0x2ecc71).setDescription(desc); }
function err(desc) { return new EmbedBuilder().setColor(0xe74c3c).setDescription(desc); }

function keysOfKind(kind, list) {
    return Object.entries(cfg.KEYS)
        .filter(([, def]) => def.kind === kind && !!def.list === list && !def.internal)
        .map(([key, def]) => ({ key, def }));
}

function mention(key, value) {
    const kind = cfg.KEYS[key]?.kind;
    if (!value) return '*not set*';
    if (kind === 'channel') return `<#${value}>`;
    if (kind === 'role')    return `<@&${value}>`;
    if (kind === 'user')    return `<@${value}>`;
    return `\`${value}\``;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Per-server settings for every feature that used to be hardcoded.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(s => s.setName('view')
            .setDescription('Show every setting for this server and whether it is set.'))
        .addSubcommand(s => s.setName('set-channel')
            .setDescription('Point a channel setting at a channel.')
            .addStringOption(o => o.setName('key').setDescription('Which setting').setRequired(true).setAutocomplete(true))
            .addChannelOption(o => o.setName('channel').setDescription('Target channel or category').setRequired(true)))
        .addSubcommand(s => s.setName('set-role')
            .setDescription('Point a role setting at a role.')
            .addStringOption(o => o.setName('key').setDescription('Which setting').setRequired(true).setAutocomplete(true))
            .addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
        .addSubcommand(s => s.setName('add')
            .setDescription('Add an entry to a list setting.')
            .addStringOption(o => o.setName('key').setDescription('Which list').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('value').setDescription('Channel, role or user — mention or raw id').setRequired(true)))
        .addSubcommand(s => s.setName('remove')
            .setDescription('Remove an entry from a list setting.')
            .addStringOption(o => o.setName('key').setDescription('Which list').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('value').setDescription('Channel, role or user — mention or raw id').setRequired(true)))
        .addSubcommand(s => s.setName('clear')
            .setDescription('Unset a setting. The feature that uses it then stays quiet.')
            .addStringOption(o => o.setName('key').setDescription('Which setting').setRequired(true).setAutocomplete(true))),

    async autocomplete(interaction) {
        const sub     = interaction.options.getSubcommand();
        const typed   = (interaction.options.getFocused() || '').toLowerCase();
        let candidates;

        if (sub === 'set-channel')      candidates = keysOfKind('channel', false);
        else if (sub === 'set-role')    candidates = keysOfKind('role', false);
        else if (sub === 'add' || sub === 'remove') {
            candidates = Object.entries(cfg.KEYS)
                .filter(([, def]) => def.list && !def.internal)
                .map(([key, def]) => ({ key, def }));
        } else {
            candidates = Object.entries(cfg.KEYS)
                .filter(([, def]) => !def.internal)
                .map(([key, def]) => ({ key, def }));
        }

        const shown = candidates
            .filter(({ key, def }) =>
                key.toLowerCase().includes(typed) || (def.label || '').toLowerCase().includes(typed))
            .slice(0, 25)
            .map(({ key, def }) => ({ name: `${def.label || key} (${key})`.slice(0, 100), value: key }));

        return interaction.respond(shown);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        if (sub === 'view') {
            const values = await cfg.all(interaction.guildId);
            const groups = {};
            for (const [key, def] of Object.entries(cfg.KEYS)) {
                if (def.internal) continue;
                const group = key.split(':')[0];
                (groups[group] ||= []).push({ key, def, value: values[key] });
            }
            const shownCount = Object.values(groups).reduce((n, rows) => n + rows.length, 0);

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`Settings — ${interaction.guild.name}`)
                .setDescription('Anything left unset simply stays off; nothing falls back to another server.');

            let unset = 0;
            for (const [group, rows] of Object.entries(groups)) {
                embed.addFields({
                    name : group,
                    value: rows.map(({ key, def, value }) => {
                        const isEmpty = def.list ? !value.length : !value;
                        if (isEmpty) unset++;
                        const rendered = def.list
                            ? (value.length ? value.map(v => mention(key, v)).join(' ') : '*not set*')
                            : mention(key, value);
                        return `\`${key}\` — ${rendered}`;
                    }).join('\n').slice(0, 1024)
                });
            }
            embed.setFooter({ text: `${Object.keys(cfg.KEYS).length - unset} set, ${unset} unset` });
            return interaction.editReply({ embeds: [embed] });
        }

        const key = interaction.options.getString('key');
        if (!cfg.isKnown(key)) {
            return interaction.editReply({ embeds: [err(`❌ \`${key}\` is not a known setting. Pick one from the suggestions.`)] });
        }
        const def = cfg.KEYS[key];

        if (sub === 'clear') {
            await cfg.clear(interaction.guildId, key);
            interaction.client.emit('guildConfigUpdate', interaction.guildId);
            return interaction.editReply({ embeds: [ok(`🧹 \`${key}\` cleared. That feature will stay quiet until it is set again.`)] });
        }

        if (sub === 'set-channel' || sub === 'set-role') {
            if (def.list) {
                return interaction.editReply({ embeds: [err(`❌ \`${key}\` holds a list — use \`/config add\`.`)] });
            }
            const target = sub === 'set-channel'
                ? interaction.options.getChannel('channel')
                : interaction.options.getRole('role');

            if (sub === 'set-channel' && def.kind !== 'channel') {
                return interaction.editReply({ embeds: [err(`❌ \`${key}\` expects a ${def.kind}, not a channel.`)] });
            }
            if (sub === 'set-role' && def.kind !== 'role') {
                return interaction.editReply({ embeds: [err(`❌ \`${key}\` expects a ${def.kind}, not a role.`)] });
            }

            await cfg.set(interaction.guildId, key, target.id);
            interaction.client.emit('guildConfigUpdate', interaction.guildId);
            // /setup logs reads the old field; keep both in step for that one key.
            if (key === 'channels:log') interaction.client.emit('logConfigUpdate', interaction.guildId);

            const embed = ok(`✅ \`${key}\` → ${mention(key, target.id)}`);
            if (def.help) embed.addFields({ name: 'What this does', value: def.help });

            if (def.kind === 'channel' && target.type === ChannelType.GuildText) {
                const perms = target.permissionsFor(interaction.guild.members.me);
                if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
                    embed.addFields({
                        name : '⚠️ Warning',
                        value: 'I cannot send messages or embeds there yet, so nothing will arrive until that is fixed.'
                    });
                }
            }
            return interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'add' || sub === 'remove') {
            if (!def.list) {
                return interaction.editReply({ embeds: [err(`❌ \`${key}\` holds a single value — use \`/config set-channel\` or \`/config set-role\`.`)] });
            }
            const raw = interaction.options.getString('value');
            const id  = (raw.match(/\d{17,20}/) || [])[0];
            if (!id) {
                return interaction.editReply({ embeds: [err('❌ I could not find an id in that. Mention the channel/role/user, or paste its id.')] });
            }

            if (sub === 'add') await cfg.addToList(interaction.guildId, key, id);
            else               await cfg.removeFromList(interaction.guildId, key, id);
            interaction.client.emit('guildConfigUpdate', interaction.guildId);

            const now = await cfg.getList(interaction.guildId, key);
            return interaction.editReply({ embeds: [
                ok(`${sub === 'add' ? '➕ Added to' : '➖ Removed from'} \`${key}\`.`)
                    .addFields({ name: 'Now', value: now.length ? now.map(v => mention(key, v)).join(' ') : '*empty*' })
            ]});
        }
    }
};

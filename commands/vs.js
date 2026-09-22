//--------------------------------
// IMPORTS
//--------------------------------
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const DriverRating = require('../models/DriverRating');
const axios = require('axios');

//--------------------------------
// RATING COLOR
//--------------------------------
function getRatingColor(rating) {
    if (rating >= 75) return '#00E676';
    if (rating >= 50) return '#FFEB3B';
    if (rating >= 25) return '#FF9800';
    return '#F44336';
}

//--------------------------------
// COMMAND EXECUTION
//--------------------------------
module.exports = {
    data: new SlashCommandBuilder()
        .setName('vs')
        .setDescription('Compare two drivers head to head')
        .addUserOption(opt => opt.setName('driver1').setDescription('First Driver').setRequired(true))
        .addUserOption(opt => opt.setName('driver2').setDescription('Second Driver').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const user1 = interaction.options.getUser('driver1');
        const user2 = interaction.options.getUser('driver2');

        if (user1.id === user2.id)
            return interaction.editReply('❌ Please select two different drivers.');

        const [dr1, dr2] = await Promise.all([
            DriverRating.findOne({ userId: user1.id }),
            DriverRating.findOne({ userId: user2.id }),
        ]);

        if (!dr1 || !dr2)
            return interaction.editReply('❌ One or both drivers have not been rated yet. Admins must rate drivers via the web panel first.');

        if (dr1.ratedBy === 0 || dr2.ratedBy === 0)
            return interaction.editReply('❌ One or both drivers have no ratings submitted yet.');

        const rating1 = dr1.avg.overall;
        const rating2 = dr2.avg.overall;
        const color1  = getRatingColor(rating1);
        const color2  = getRatingColor(rating2);

        //--------------------------------
        // COOKIE API CARD
        //--------------------------------
        const requestBody = {
            card: {
                height: "300",
                width: "700",
                bg: "#0d0d1a",
                bg_type: "color"
            },
            elements: [
                // ---- Left name ----
                {
                    id: "left-name", type: "text",
                    text: user1.username.toUpperCase(),
                    text_size: "22", font: "Roboto", color: "#ffffff",
                    transparency: "100", layer: "2",
                    position: { x: 10, y: 20 }, size: { width: 300, height: 40 }
                },
                // ---- Right name ----
                {
                    id: "right-name", type: "text",
                    text: user2.username.toUpperCase(),
                    text_size: "22", font: "Roboto", color: "#ffffff",
                    transparency: "100", layer: "2",
                    position: { x: 390, y: 20 }, size: { width: 300, height: 40 }
                },
                // ---- VS label ----
                {
                    id: "vs-label", type: "text", text: "VS",
                    text_size: "28", font: "Roboto", color: "#aaaaaa",
                    transparency: "100", layer: "2",
                    position: { x: 320, y: 15 }, size: { width: 60, height: 50 }
                },
                // ---- Left overall rating ----
                {
                    id: "left-rating", type: "text",
                    text: rating1.toString(),
                    text_size: "60", font: "Roboto", color: color1,
                    transparency: "100", layer: "2",
                    position: { x: 10, y: 70 }, size: { width: 300, height: 80 }
                },
                // ---- Right overall rating ----
                {
                    id: "right-rating", type: "text",
                    text: rating2.toString(),
                    text_size: "60", font: "Roboto", color: color2,
                    transparency: "100", layer: "2",
                    position: { x: 390, y: 70 }, size: { width: 300, height: 80 }
                },
                // ---- Left criteria ----
                {
                    id: "left-stats", type: "text",
                    text: `PAC ${dr1.avg.pace}  CRA ${dr1.avg.racecraft}  DEF ${dr1.avg.defending}`,
                    text_size: "14", font: "Roboto", color: "#aaaaaa",
                    transparency: "100", layer: "2",
                    position: { x: 10, y: 165 }, size: { width: 330, height: 30 }
                },
                {
                    id: "left-extra", type: "text",
                    text: `OVT ${dr1.avg.overtaking}  CON ${dr1.avg.consistency}  EXP ${dr1.avg.experience}`,
                    text_size: "14", font: "Roboto", color: "#aaaaaa",
                    transparency: "100", layer: "2",
                    position: { x: 10, y: 200 }, size: { width: 330, height: 30 }
                },
                // ---- Left rated by ----
                {
                    id: "left-ratedby", type: "text",
                    text: `Rated by ${dr1.ratedBy} admin${dr1.ratedBy !== 1 ? 's' : ''}`,
                    text_size: "12", font: "Roboto", color: "#555555",
                    transparency: "100", layer: "2",
                    position: { x: 10, y: 255 }, size: { width: 300, height: 25 }
                },
                // ---- Right criteria ----
                {
                    id: "right-stats", type: "text",
                    text: `PAC ${dr2.avg.pace}  CRA ${dr2.avg.racecraft}  DEF ${dr2.avg.defending}`,
                    text_size: "14", font: "Roboto", color: "#aaaaaa",
                    transparency: "100", layer: "2",
                    position: { x: 390, y: 165 }, size: { width: 330, height: 30 }
                },
                {
                    id: "right-extra", type: "text",
                    text: `OVT ${dr2.avg.overtaking}  CON ${dr2.avg.consistency}  EXP ${dr2.avg.experience}`,
                    text_size: "14", font: "Roboto", color: "#aaaaaa",
                    transparency: "100", layer: "2",
                    position: { x: 390, y: 200 }, size: { width: 330, height: 30 }
                },
                // ---- Right rated by ----
                {
                    id: "right-ratedby", type: "text",
                    text: `Rated by ${dr2.ratedBy} admin${dr2.ratedBy !== 1 ? 's' : ''}`,
                    text_size: "12", font: "Roboto", color: "#555555",
                    transparency: "100", layer: "2",
                    position: { x: 390, y: 255 }, size: { width: 300, height: 25 }
                },
            ]
        };

        try {
            const apiResponse = await axios.post(
                'https://api.cookie-api.com/api/cards/card-builder/build',
                requestBody,
                {
                    headers: {
                        'Authorization': process.env.COOKIE_API_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const result = apiResponse.data;

            if (!result.success) {
                console.error('Cookie API error:', JSON.stringify(result));
                return interaction.editReply(`❌ Card generation failed: ${result.errors?.[0]?.message || 'Unknown error'}`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`${user1.username} vs ${user2.username}`)
                .setImage(result.url)
                .setColor(rating1 >= rating2 ? color1 : color2);

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const errBody = error.response?.data;
            console.error('VS command error:', typeof errBody === 'object' ? JSON.stringify(errBody) : errBody);
            return interaction.editReply(`❌ API Error ${error.response?.status || ''}: ${errBody?.errors?.[0]?.message || 'Failed to connect'}`);
        }
    }
};

# OM-Bot

A Discord bot for sim-racing communities — moderation, an economy, party games,
race timers, and **Chamy**, a Gemini-powered AI assistant. Originally built
hardcoded for one server (Olzhasstik Motorsports), now usable in any server:
commands register globally, and everything that used to be a fixed channel or
role ID is a per-server setting via `/config`.

## Features

* **Per-server configuration** (`/config`) — channels, roles and categories
  for every feature are set per guild, not hardcoded. `/config view` shows
  what's set; unset features simply stay off, they never fall back to
  another server's values.
* **Chamy** — a Gemini-powered assistant (`@Chamy <question>` or
  `hey chamy <question>`). Asleep by default in every server except OM's own;
  the bot operator wakes it per-server with a fixed phrase. Chamy carries
  OM League knowledge and moderation tools only inside OM's own server —
  everywhere else it's a generic assistant with no OM-specific facts to hand
  out. Backed by MongoDB-cached channel scanning and Gemini vision for
  reading standings/results images.
* **Economy** — coin wallets (global per user), earned through channel
  activity (Madcardex/Ballsdex/F1dex catches, Arcane level-ups), a small
  casino, and driver ratings (PAC/CRA/DEF/OVT/CON/EXP).
* **Moderation** — ban/kick/mute/warn/jail, with a configurable co-owner
  role and a bot-operator tier that works the same in every server.
* **Race timers** — auto-detects race announcements in configured channels
  and posts a countdown reminder.
* **Bump reminders** — Disboard/Carl bump tracking, per server.
* **Party games** — trivia, Gartic, Hunger Games, Millionaire, Jenga, drag
  race, Keep Talking, caption battles, and more.
* **Team radio** — temporary voice channels for race teams.
* **OM-only features** — the Minecraft server bridge (Exaroton), welcome DMs,
  the reaction-role league picker, and the moderation dashboard are tied to
  OM's own server/API keys and stay off elsewhere.

## Tech stack

* Node.js, [discord.js](https://discord.js.org/) v14
* MongoDB / Mongoose
* Google Gemini (`@google/generative-ai`) for Chamy

## Setup

```bash
git clone https://github.com/Gofretfkintank/OM-Bot.git
cd OM-Bot
npm install
```

Create a `.env` file:

| Variable | Required | Purpose |
|---|---|---|
| `TOKEN` | yes | Discord bot token |
| `CLIENT_ID` | yes | Discord application ID (for slash command registration) |
| `MONGO_URI` | yes | MongoDB connection string |
| `OWNER_IDS` | recommended | Comma-separated Discord user ID(s) with bot-operator access everywhere (Chamy wake/sleep, moderation bypass, `/config`-independent full power). Falls back to the original OM commander ID if unset. |
| `GEMINI_API_KEY` | for Chamy | Google Gemini API key. Chamy stays silent without it. |
| `ALLOWED_GUILDS` | optional | Comma-separated guild IDs to restrict the bot to. Leave unset for "works in any server". |
| `LEGACY_GUILD_ID` | no | OM's own guild ID — gates the OM-only features above. Defaults to OM's actual ID; only needed to point it elsewhere. |
| `EXAROTON_API_KEY` | for `/mcturn` | Only used in OM's own server. |
| `REPORT_LOG_ID` | for `/report` | Channel ID the report tool logs to. |

Start it:

```bash
npm start
```

### Registering slash commands

Commands register **globally** on every boot (`ready` in `index.js`), so a
normal start is enough for the bot to work in any server it's invited to —
global propagation can take up to an hour on a fresh app. For instant
registration to specific servers while developing:

```bash
DEPLOY_SCOPE=guild DEV_GUILD_IDS=123,456 npm run deploy
```

### Per-server setup

Once the bot is in a server, an admin runs `/config view` to see every
configurable feature, then `/config set-channel`, `/config set-role`,
`/config add` / `/config remove` (for list settings) and `/config clear`.
A feature whose setting is unset stays quiet rather than guessing.

## License

MIT — see [LICENSE](LICENSE).

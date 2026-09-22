const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// ─────────────────────────────────────────────────────────────────────────────
//  CHAOS POOL  (100 scenarios)
//  Categories: Grid | Points | Rules | Race Format | Strategy & Psychology
//
//  affectsResults:
//    null     → does not touch coin rewards at all
//    'auto'   → bot calculates automatically when chaos ID is set in /results
//    'manual' → bot cannot calculate; shows a warning note in /results output
//
//  modifier (only when affectsResults === 'auto'):
//    { type: 'multiply', value: N }  → multiply all position rewards by N
//    { type: 'reverse' }             → reverse the reward table (last gets most)
//    { type: 'flat', value: N }      → every finisher gets N coins
//    { type: 'zero_winner' }         → P1 earns 0 coins, rest earn normally
//    { type: 'podium_only' }         → only P1/P2/P3 earn coins (3x each)
//    { type: 'zero_all' }            → nobody earns any coins (glory only)
// ─────────────────────────────────────────────────────────────────────────────
const CHAOS_POOL = [
  // ── GRID CHAOS ──────────────────────────────────────────────────────────────
  { id: 1,  category: '🔀 Grid Chaos', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Full Reverse Grid',
    description: 'All drivers start in reverse championship order. The leader starts last, the last-place driver starts from pole!' },
  { id: 2,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Top 10 Reverse',
    description: "Only the top 10's grid positions are reversed. P10 starts from pole, P1 starts P10." },
  { id: 3,  category: '🔀 Grid Chaos', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Full Random Draw',
    description: 'All grid positions are determined by a random draw. Qualifying means nothing — pure luck!' },
  { id: 4,  category: '🔀 Grid Chaos', intensity: '🔥', affectsResults: null,
    title: 'Odd-Even Swap',
    description: 'Drivers in odd grid positions swap with drivers in even positions. The grid becomes a zigzag!' },
  { id: 5,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Last Race Reversal',
    description: "The finishing order of the previous race becomes this race's starting grid — but reversed!" },
  { id: 6,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: "Champion's Penalty",
    description: 'The championship leader starts from the very back of the grid. Prove your worth!' },
  { id: 7,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Top 3 to the Pit Lane',
    description: 'The top 3 in the championship start from the pit lane. Everyone else lines up normally.' },
  { id: 8,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Block Swap',
    description: 'The grid is split in half: the back half moves to the front, the front half moves to the back.' },
  { id: 9,  category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Rival Pick',
    description: 'Each driver nominates a rival they want to battle. The matchups determine grid order.' },
  { id: 10, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Points Gap Grid',
    description: 'Grid is determined not by championship points, but by the GAP to the leader. Smallest gap = pole!' },

  // ── POINTS SYSTEM ───────────────────────────────────────────────────────────
  { id: 11, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'auto', modifier: { type: 'multiply', value: 2 },
    title: 'Double Points',
    description: 'All coin rewards are doubled for this race. Every single position matters more than ever!' },
  { id: 12, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'auto', modifier: { type: 'multiply', value: 0.5 },
    title: 'Half Points',
    description: 'Coin rewards are halved for this race. Low pressure on paper, high risk in practice!' },
  { id: 13, category: '🏆 Points System', intensity: '🔥🔥🔥',
    affectsResults: 'auto', modifier: { type: 'reverse' },
    title: 'Reversed Points',
    description: "The reward table is flipped: last place gets P1's coins, first place gets last place's coins!" },
  { id: 14, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'auto', modifier: { type: 'flat', value: 100 },
    title: 'Flat Points',
    description: 'Every finisher receives 100 coins regardless of finishing position — but only if they finish!' },
  { id: 15, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Apply gap bonus coins to P2/P3 manually via /addcoins based on finishing gap.',
    title: 'Gap Bonus',
    description: 'The closer P2 and P3 finish to the winner, the more bonus coins they earn.' },
  { id: 16, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Run /results twice (mid-race checkpoint + finish) or add bonus coins manually.',
    title: 'Mid-Race Checkpoint Points',
    description: 'The standings at a specific lap mid-race also award coins. The first half counts too!' },
  { id: 17, category: '🏆 Points System', intensity: '🔥🔥🔥',
    affectsResults: 'auto', modifier: { type: 'zero_winner' },
    title: 'Zero Points for the Winner',
    description: 'First place earns zero coins. All rewards are distributed from P2 downwards!' },
  { id: 18, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Identify the driver with most positions gained and add bonus coins via /addcoins.',
    title: 'Overtake Bonus',
    description: 'The driver who gains the most positions during the race earns a bonus.' },
  { id: 19, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Add bonus coins to the driver who led lap 1 manually via /addcoins.',
    title: 'First Lap Leader Bonus',
    description: 'The driver leading after lap 1 earns extra bonus coins. Aggressive starts are a must!' },
  { id: 20, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Add bonus coins to drivers who gained positions on the final lap via /addcoins.',
    title: 'Final Lap Frenzy',
    description: 'Every driver who gains a position on the final lap earns bonus coins per position gained.' },

  // ── RACE RULES ──────────────────────────────────────────────────────────────
  { id: 21, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Stay Close Rule',
    description: 'You must stay within 5 seconds of another driver at all times. Go solo and receive a +10s penalty!' },
  { id: 22, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'No Overtaking — First 3 Laps',
    description: 'Overtaking is banned for the first 3 laps. Hold your position and be patient!' },
  { id: 23, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'No Overtaking — Last 5 Laps',
    description: "No overtakes allowed in the final 5 laps. You better be in a good position before then!" },
  { id: 24, category: '📋 Race Rule', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Red Flag Wildcard',
    description: 'The admin can throw a red flag mid-race and reshuffle the grid at any point. Expect the unexpected!' },
  { id: 25, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Position Freeze',
    description: 'At a specified lap, the current standings are frozen and used as the points basis for the race.' },
  { id: 26, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'No Intra-Team Overtaking',
    description: 'Teammates cannot overtake each other. Team order must be maintained throughout the race!' },
  { id: 27, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Mandatory Slow Zone',
    description: 'The admin designates a specific section of the track as a "slow zone." Violations result in a penalty.' },
  { id: 28, category: '📋 Race Rule', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Grid Penalty Lottery',
    description: "A draw is held and 3 random drivers each receive a 5-place grid penalty. Who's name gets pulled?" },
  { id: 29, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Overtake Limit',
    description: 'A maximum of 5 overtakes per driver is allowed during the race. Every move counts — use them wisely!' },
  { id: 30, category: '📋 Race Rule', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Mandatory Drop to Last',
    description: 'At a set lap, the championship leader must deliberately drop to the back of the field.' },

  // ── RACE FORMAT ─────────────────────────────────────────────────────────────
  { id: 31, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Sprint + Feature Race',
    description: 'A short sprint race is held first. Its result determines the grid for the main feature race.' },
  { id: 32, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Double Header',
    description: 'Two separate races on the same track! The first race result sets the grid for the second.' },
  { id: 33, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Team Relay Race',
    description: 'Teams are formed. Each driver races for a set number of laps before the next teammate takes over.' },
  { id: 34, category: '🏁 Race Format', intensity: '🔥', affectsResults: null,
    title: 'Half Distance',
    description: 'The race runs at half the normal lap count. Every second, every meter is critical!' },
  { id: 35, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: '1.5x Extended Race',
    description: 'This race is 1.5 times longer than normal. Concentration and stamina are everything!' },
  { id: 36, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Mystery Track',
    description: 'The race venue is revealed at the last moment by the admin. No time to prepare!' },
  { id: 37, category: '🏁 Race Format', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Add fastest lap bonus coins manually via /addcoins to the driver with the fastest lap.',
    title: 'Fastest Lap Race',
    description: 'The driver who sets the fastest lap earns bonus coins. The hotlap matters as much as the finish!' },
  { id: 38, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Custom Finish Point',
    description: "The race doesn't end at the normal finish line — the admin designates a different checkpoint as the finish." },
  { id: 39, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Elimination Race',
    description: 'Every N laps, the last-placed driver is eliminated and must retire from the race!' },
  { id: 40, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Double Track Weekend',
    description: 'Two races on two different tracks in the same week. Points from both are combined.' },

  // ── STRATEGY & PSYCHOLOGY ───────────────────────────────────────────────────
  { id: 41, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: "Award secret objective bonus coins via /addcoins after verifying each driver's objective.",
    title: 'Secret Objective',
    description: 'Each driver is given a private secret objective (e.g., "gain 3 positions"). Complete it for bonus coins!' },
  { id: 42, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Add rival matchup bonus coins via /addcoins to drivers who beat their assigned rival.',
    title: 'Rival Matchup',
    description: 'The admin randomly pairs up drivers. Beat your assigned rival in the race to earn bonus coins!' },
  { id: 43, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: "Award team bonus coins via /addcoins to the winning team's members.",
    title: 'Team Championship',
    description: "Random teams are formed. The team whose lead driver finishes highest also earns bonus coins for the team." },
  { id: 44, category: '🧠 Strategy & Psychology', intensity: '🔥', affectsResults: null,
    title: 'Radio Silence',
    description: 'No strategy sharing is allowed in Discord during the race. No tips, no callouts — total radio silence!' },
  { id: 45, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Blind Track',
    description: "The track is revealed only 10 minutes before race start. No one has time to practice!" },
  { id: 46, category: '🧠 Strategy & Psychology', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Fake Grid',
    description: 'The admin announces a false grid order. The real grid is only revealed when the race broadcast starts. Mind games!' },
  { id: 47, category: '🧠 Strategy & Psychology', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Add prediction bonus coins via /addcoins to drivers who correctly predicted their finish.',
    title: 'Prediction Points',
    description: 'Before the race, each driver predicts their own finishing position. A correct prediction earns bonus coins!' },
  { id: 48, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'auto', modifier: { type: 'multiply', value: 2 },
    title: 'Championship Simulation',
    description: "This race's coin rewards are doubled. Every position has amplified stakes." },
  { id: 49, category: '🧠 Strategy & Psychology', intensity: '🔥', affectsResults: null,
    title: 'Sign-Up Penalty',
    description: "Drivers must register for this race in advance. Anyone who doesn't register in time starts from the back!" },
  { id: 50, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Add head-to-head bonus coins via /addcoins to whichever rival finished ahead.',
    title: 'Head-to-Head Bet',
    description: 'The two closest rivals in the championship face a special side bet. Whoever finishes ahead earns bonus coins!' },

  // ── ADDITIONAL SCENARIOS (51–100) ───────────────────────────────────────────
  { id: 51, category: '🔀 Grid Chaos', intensity: '🔥🔥🔥',
    affectsResults: 'manual', manualNote: 'Run the draw manually and remove coins from the selected driver via /removecoins if triggered.',
    title: 'Points Reset Threat',
    description: "A draw is held — one random driver's coins from this race could be wiped. Everyone has the same risk!" },
  { id: 52, category: '🏆 Points System', intensity: '🔥🔥🔥',
    affectsResults: 'manual', manualNote: "Apply the winner's coin transfer decision manually via /addcoins or /removecoins.",
    title: 'Points Transfer',
    description: 'The race winner can choose to give coins to — or take coins from — any other driver.' },
  { id: 53, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'Safety Laps',
    description: 'Certain designated laps are declared "safe laps." No overtaking is permitted — just hold your position.' },
  { id: 54, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Mandatory Slow Lap',
    description: 'At a mid-race point, all drivers must complete a full formation-pace slow lap together.' },
  { id: 55, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Veto Power',
    description: 'The winner of the previous race earns the right to veto one rule this weekend. Power is in their hands!' },
  { id: 56, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Grid Rotation',
    description: 'Every grid position shifts forward by 5 spots. P1 → P6, P6 → P11, and so on.' },
  { id: 57, category: '🏆 Points System', intensity: '🔥🔥🔥',
    affectsResults: 'manual', manualNote: 'Remove coins from the bottom 3 finishers manually via /removecoins after posting results.',
    title: 'Negative Points Risk',
    description: "The bottom 3 finishers don't just miss out on coins — they LOSE coins." },
  { id: 58, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Outside-Only Overtaking',
    description: "Only overtakes made around the outside of a corner are valid. Inside passes don't count!" },
  { id: 59, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Two-Part Race',
    description: 'The race is split into two halves. Each half is scored and coins from both are combined.' },
  { id: 60, category: '🧠 Strategy & Psychology', intensity: '🔥🔥🔥',
    affectsResults: 'manual', manualNote: "Manually adjust the championship leader's coin reward after results are posted.",
    title: "Champion's Burden",
    description: "The championship leader's coins are multiplied this race. Great power, great risk!" },
  { id: 61, category: '🔀 Grid Chaos', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Favourites to the Back',
    description: 'The top 5 in the championship standings must start from the last 5 grid positions.' },
  { id: 62, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'auto', modifier: { type: 'podium_only' },
    title: 'Podium Only',
    description: 'Only the top 3 finishers earn coins — but their rewards are tripled for this race!' },
  { id: 63, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'Sequential Overtake Limit',
    description: 'You cannot overtake the same driver more than twice within 2 laps. Force your strategy!' },
  { id: 64, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Night Surprise',
    description: 'On race day, the admin may add one bonus chaos rule that was not announced beforehand.' },
  { id: 65, category: '🧠 Strategy & Psychology', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Handicapped Favourite',
    description: 'The driver with the most championship points starts with a mandatory +15s time penalty.' },
  { id: 66, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Double Draw',
    description: 'The grid is determined by two separate draws. The second draw overrides the first!' },
  { id: 67, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: "Add the previous three races' coin totals manually to each driver via /addcoins.",
    title: 'Cumulative Winner',
    description: "This race's coins are stacked on top of the previous three races' totals — a triple-race bonus!" },
  { id: 68, category: '📋 Race Rule', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Add clean driver bonus coins via /addcoins to qualifying drivers after the race.',
    title: 'Clean Driver Award',
    description: 'Any driver who completes the race without incidents earns bonus coins.' },
  { id: 69, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Time Trial Weekend',
    description: "No race this week — the fastest single lap time is what's scored. Who has the best hotlap?" },
  { id: 70, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Community Vote',
    description: 'Drivers vote on which chaos rule to apply this race. The majority decides the format!' },
  { id: 71, category: '🔀 Grid Chaos', intensity: '🔥', affectsResults: null,
    title: 'Alphabetical Grid',
    description: 'Grid positions are determined alphabetically by driver name. Your name might be your advantage!' },
  { id: 72, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Calculate gap-based coin amounts manually and distribute via /addcoins based on finishing gaps.',
    title: 'Gap-Based Points',
    description: 'Coins are scaled based on your finishing gap to the winner. The closer you finish, the more you earn!' },
  { id: 73, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'Position Lock',
    description: 'Starting grid positions are locked for the first 5 laps. After that, everything is open!' },
  { id: 74, category: '🏁 Race Format', intensity: '🔥🔥', affectsResults: null,
    title: 'Regional Teams',
    description: 'Drivers are split into regional teams. One representative races per team and team coins are totaled.' },
  { id: 75, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Anonymous Grid',
    description: 'The grid is kept secret until the broadcast starts. Preparation disrupted!' },
  { id: 76, category: '🔀 Grid Chaos', intensity: '🔥', affectsResults: null,
    title: 'Single File Start',
    description: 'The entire grid lines up in a single file — no side-by-side rows. First come, first served.' },
  { id: 77, category: '🏆 Points System', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Add underdog bonus coins to the bottom 3 championship drivers manually via /addcoins.',
    title: 'Underdog Bonus',
    description: 'The bottom 3 drivers in the championship start this race with a coin head start.' },
  { id: 78, category: '📋 Race Rule', intensity: '🔥', affectsResults: null,
    title: 'Mandatory Position Defence',
    description: 'Every driver must actively defend their position for at least 3 consecutive laps during the race.' },
  { id: 79, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Head-to-Head Bracket',
    description: 'Drivers are split into 1v1 pairs. Each pair races independently, then winners meet in a final!' },
  { id: 80, category: '🧠 Strategy & Psychology', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Remove coins from the designated driver manually via /removecoins after admin judgment.',
    title: 'Detective Mode',
    description: 'After the race, the driver judged to have made the most tactical errors by the admin loses coins.' },
  { id: 81, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: "Last Week's Biggest Loser Gets Pole",
    description: 'The driver who lost the most positions in the previous race starts this race from pole!' },
  { id: 82, category: '🏆 Points System', intensity: '🔥🔥🔥',
    affectsResults: 'auto', modifier: { type: 'zero_all' },
    title: 'No Points, Just Glory',
    description: "This race awards zero coins. But the winner's name is immortalised in OM history!" },
  { id: 83, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'No Early Retirement',
    description: 'Any driver who retires before lap 10 receives a 5-place grid penalty for the next race.' },
  { id: 84, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Shuttle Race',
    description: 'Drivers race the track A → B, then B → A in reverse (if the game allows it). Back and forth chaos!' },
  { id: 85, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Silent Leader',
    description: 'The championship leader is banned from typing in Discord during the entire race. No comms for the top dog!' },
  { id: 86, category: '🔀 Grid Chaos', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Roll the Dice',
    description: 'The admin rolls a live 1d20 dice. The result determines how many positions the top N drivers are shifted.' },
  { id: 87, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'manual', manualNote: "Compare last race's earnings and add most-improved bonus manually via /addcoins.",
    title: 'Most Improved Bonus',
    description: 'The driver who gains the most coins compared to last race earns a bonus.' },
  { id: 88, category: '📋 Race Rule', intensity: '🔥🔥', affectsResults: null,
    title: 'Zero Tolerance Track Limits',
    description: 'Any track limit violation results in an immediate position penalty this race. No steward review — instant action!' },
  { id: 89, category: '🏁 Race Format', intensity: '🔥🔥🔥', affectsResults: null,
    title: 'Mystery Lap Count',
    description: 'The total number of laps is not revealed. The admin can wave the chequered flag at any moment!' },
  { id: 90, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Captains Pick',
    description: 'The top 2 drivers in the championship become team captains and take turns picking their teammates.' },
  { id: 91, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Community Grid Vote',
    description: 'The community votes to determine the grid positions of 3 specific drivers. The rest line up normally.' },
  { id: 92, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'Add first blood bonus coins via /addcoins to whoever made the first overtake.',
    title: 'First Blood Bonus',
    description: 'The driver who makes the first overtake of the race earns bonus coins. Who strikes first?' },
  { id: 93, category: '📋 Race Rule', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Run the community vote and remove coins from the voted dirtiest driver via /removecoins.',
    title: 'Sportsmanship Rule',
    description: 'Contact is not penalised during the race — but after the race, a community vote decides the "dirtiest" driver who loses coins.' },
  { id: 94, category: '🏁 Race Format', intensity: '🔥', affectsResults: null,
    title: 'Mid-Season Opener',
    description: 'This race is officially declared the "Mid-Season Opener." The winner receives a special title and recognition!' },
  { id: 95, category: '🧠 Strategy & Psychology', intensity: '🔥🔥', affectsResults: null,
    title: 'Rule Vote',
    description: 'Each driver proposes one rule. The most voted rule becomes law for this race!' },
  { id: 96, category: '🔀 Grid Chaos', intensity: '🔥🔥', affectsResults: null,
    title: 'Last-Minute Grid',
    description: 'The grid is only revealed exactly 2 minutes before the race starts. Are you ready?' },
  { id: 97, category: '🏆 Points System', intensity: '🔥',
    affectsResults: 'manual', manualNote: 'If the P1–P2 gap was under 5 seconds, add bonus coins to both via /addcoins.',
    title: 'Close Finish Bonus',
    description: 'If the gap between P1 and P2 is less than 5 seconds, both drivers earn bonus coins!' },
  { id: 98, category: '📋 Race Rule', intensity: '🔥🔥',
    affectsResults: 'manual', manualNote: 'Add guardian bonus coins via /addcoins if the condition was met.',
    title: 'Guardian Driver',
    description: 'The last-placed driver in the championship is assigned a "guardian." If the guardian leads them by more than 5 laps, they earn bonus coins.' },
  { id: 99, category: '🏁 Race Format', intensity: '🔥', affectsResults: null,
    title: 'Mid-Season Finale',
    description: 'This race is the official "Mid-Season Finale." Hosted with a special announcement and prize ceremony!' },
  { id: 100, category: '🧠 Strategy & Psychology', intensity: '🔥🔥🔥🔥',
    affectsResults: 'manual', manualNote: 'Apply the 3 drawn rules individually — some may require manual coin adjustments via /addcoins or /removecoins.',
    title: 'FULL CHAOS',
    description: '🎲 The admin randomly picks 3 rules from the pool and applies ALL OF THEM at once. Nobody is safe!' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function intensityColor(intensity) {
  const count = (intensity.match(/🔥/g) || []).length;
  if (count >= 4) return 0xFF0000;
  if (count === 3) return 0xFF6600;
  if (count === 2) return 0xFFA500;
  return 0xFFD700;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORTS  —  CHAOS_POOL is exported so results.js can import it
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  CHAOS_POOL,

  data: new SlashCommandBuilder()
    .setName('chaoscall')
    .setDescription('🎲 Draws a random Chaos Call for the mid-season!')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('Pick a specific chaos ID (1-100). Leave empty for a random draw.')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('announce')
        .setDescription('Ping @everyone with the announcement? (default: false)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const chosenId   = interaction.options.getInteger('id');
    const shouldPing = interaction.options.getBoolean('announce') ?? false;

    const chaos = chosenId
      ? CHAOS_POOL.find(c => c.id === chosenId)
      : CHAOS_POOL[Math.floor(Math.random() * CHAOS_POOL.length)];

    if (!chaos) {
      return interaction.reply({ content: '❌ Invalid chaos ID!', ephemeral: true });
    }

    let impactValue;
    if (!chaos.affectsResults) {
      impactValue = '✅ No coin impact — enter results normally.';
    } else if (chaos.affectsResults === 'auto') {
      impactValue = `⚡ **Auto-calculated** — select Chaos #${chaos.id} in \`/results\` and the bot handles it automatically.`;
    } else {
      impactValue = `⚠️ **Manual adjustment needed**\n${chaos.manualNote}`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎲 CHAOS CALL #${chaos.id} — ${chaos.title}`)
      .setDescription(`> ${chaos.description}`)
      .addFields(
        { name: '📂 Category',       value: chaos.category, inline: true },
        { name: '🌡️ Intensity',      value: chaos.intensity, inline: true },
        { name: '🏁 Season',         value: 'Mid-Season',    inline: true },
        { name: '💰 Results Impact',  value: impactValue,    inline: false },
      )
      .setColor(intensityColor(chaos.intensity))
      .setFooter({ text: 'Chaos Pool: 100 scenarios' })
      .setTimestamp();

    const content = shouldPing ? '@everyone\n🚨 **CHAOS CALL ACTIVE!**' : '🚨 **CHAOS CALL ACTIVE!**';

    await interaction.reply({
      content,
      embeds: [embed],
      allowedMentions: { parse: shouldPing ? ['everyone'] : [] },
    });
  },
};

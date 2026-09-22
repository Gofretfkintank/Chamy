const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');

//--------------------------------------------------
//                  TRACK DATABASE
//--------------------------------------------------
// image_url: doğrudan PNG — Discord embed için güvenilir
// Fallback olarak Wikipedia commons raster PNG'leri kullanıldı
//--------------------------------------------------

const TRACKS = {
  // ── F1 / FORMULA ──────────────────────────────
  spa: {
    name: 'Circuit de Spa-Francorchamps',
    country: 'Belgium',
    flag: '🇧🇪',
    city: 'Stavelot',
    length_km: 7.004,
    turns: 19,
    lap_record: { time: '1:41.252', driver: 'Valtteri Bottas', year: 2018, car: 'Mercedes W09' },
    drs_zones: 2,
    category: ['F1', 'GT3', 'WEC', 'Endurance'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Belgium_Circuit.png',
    notable: 'Eau Rouge / Raidillon, Pouhon, Blanchimont',
    elevation_diff_m: 104,
    weather_city: 'Stavelot,BE',
  },
  monza: {
    name: 'Autodromo Nazionale Monza',
    country: 'Italy',
    flag: '🇮🇹',
    city: 'Monza',
    length_km: 5.793,
    turns: 11,
    lap_record: { time: '1:21.046', driver: 'Rubens Barrichello', year: 2004, car: 'Ferrari F2004' },
    drs_zones: 3,
    category: ['F1', 'GT3', 'DTM'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Italy_Circuit.png',
    notable: 'Temple of Speed, Lesmo, Parabolica',
    elevation_diff_m: 14,
    weather_city: 'Monza,IT',
  },
  silverstone: {
    name: 'Silverstone Circuit',
    country: 'United Kingdom',
    flag: '🇬🇧',
    city: 'Silverstone',
    length_km: 5.891,
    turns: 18,
    lap_record: { time: '1:27.097', driver: 'Max Verstappen', year: 2020, car: 'Red Bull RB16' },
    drs_zones: 2,
    category: ['F1', 'GT3', 'BTCC'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Great_Britain_Circuit.png',
    notable: 'Copse, Maggotts-Becketts-Chapel, Stowe',
    elevation_diff_m: 17,
    weather_city: 'Silverstone,GB',
  },
  suzuka: {
    name: 'Suzuka International Racing Course',
    country: 'Japan',
    flag: '🇯🇵',
    city: 'Suzuka',
    length_km: 5.807,
    turns: 18,
    lap_record: { time: '1:30.983', driver: 'Lewis Hamilton', year: 2019, car: 'Mercedes W10' },
    drs_zones: 1,
    category: ['F1', 'Super GT', 'Super Formula'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Japan_Circuit.png',
    notable: '130R, Esses, Degner Curves',
    elevation_diff_m: 40,
    weather_city: 'Suzuka,JP',
  },
  nurburgring: {
    name: 'Nürburgring GP-Strecke',
    country: 'Germany',
    flag: '🇩🇪',
    city: 'Nürburg',
    length_km: 5.137,
    turns: 15,
    lap_record: { time: '1:27.275', driver: 'Michael Schumacher', year: 2004, car: 'Ferrari F2004' },
    drs_zones: 1,
    category: ['F1', 'GT3', 'DTM', 'Endurance'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Germany_Circuit.png',
    notable: 'Schumacher-S, Mercedes Arena, Ford Kurve',
    elevation_diff_m: 59,
    weather_city: 'Nürburg,DE',
  },
  nordschleife: {
    name: 'Nürburgring Nordschleife',
    country: 'Germany',
    flag: '🇩🇪',
    city: 'Nürburg',
    length_km: 20.832,
    turns: 73,
    lap_record: { time: '5:19.546', driver: 'Porsche 919 Hybrid Evo', year: 2018, car: 'Porsche 919 Hybrid Evo' },
    drs_zones: 0,
    category: ['GT3', 'Endurance', 'VLN', 'ADAC'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/Nordschleife.png',
    notable: 'Green Hell — Karussell, Fuchsröhre, Brünnchen',
    elevation_diff_m: 300,
    weather_city: 'Nürburg,DE',
  },
  monaco: {
    name: 'Circuit de Monaco',
    country: 'Monaco',
    flag: '🇲🇨',
    city: 'Monte Carlo',
    length_km: 3.337,
    turns: 19,
    lap_record: { time: '1:10.166', driver: 'Lewis Hamilton', year: 2021, car: 'Mercedes W12' },
    drs_zones: 1,
    category: ['F1', 'Formula E', 'GT3'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Monaco_Circuit.png',
    notable: 'Tunnel, Loews Hairpin, Casino Square',
    elevation_diff_m: 42,
    weather_city: 'Monaco,MC',
  },
  imola: {
    name: 'Autodromo Enzo e Dino Ferrari',
    country: 'Italy',
    flag: '🇮🇹',
    city: 'Imola',
    length_km: 4.909,
    turns: 19,
    lap_record: { time: '1:15.484', driver: 'Rubens Barrichello', year: 2004, car: 'Ferrari F2004' },
    drs_zones: 1,
    category: ['F1', 'Superbike', 'GT3'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Emilia_Romagna_Circuit.png',
    notable: 'Tamburello, Acque Minerali, Rivazza',
    elevation_diff_m: 26,
    weather_city: 'Imola,IT',
  },
  interlagos: {
    name: 'Autódromo José Carlos Pace',
    country: 'Brazil',
    flag: '🇧🇷',
    city: 'São Paulo',
    length_km: 4.309,
    turns: 15,
    lap_record: { time: '1:10.540', driver: 'Valtteri Bottas', year: 2018, car: 'Mercedes W09' },
    drs_zones: 2,
    category: ['F1', 'Endurance'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Brazil_Circuit.png',
    notable: 'Senna S, Curva do Sol, Juncão',
    elevation_diff_m: 37,
    weather_city: 'São Paulo,BR',
  },
  redbullring: {
    name: 'Red Bull Ring',
    country: 'Austria',
    flag: '🇦🇹',
    city: 'Spielberg',
    length_km: 4.318,
    turns: 10,
    lap_record: { time: '1:05.619', driver: 'Carlos Sainz', year: 2020, car: 'McLaren MCL35' },
    drs_zones: 3,
    category: ['F1', 'MotoGP', 'DTM', 'GT3'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Austria_Circuit.png',
    notable: 'Remus Kurve, Rindt Kurve, Red Bull Kurve',
    elevation_diff_m: 65,
    weather_city: 'Spielberg,AT',
  },
  zandvoort: {
    name: 'Circuit Zandvoort',
    country: 'Netherlands',
    flag: '🇳🇱',
    city: 'Zandvoort',
    length_km: 4.259,
    turns: 14,
    lap_record: { time: '1:11.097', driver: 'Lewis Hamilton', year: 2021, car: 'Mercedes W12' },
    drs_zones: 2,
    category: ['F1', 'GT3', 'DTM'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Netherlands_Circuit.png',
    notable: 'Tarzan, Hugenholtz, Arie Luyendyk Banked Turn',
    elevation_diff_m: 20,
    weather_city: 'Zandvoort,NL',
  },
  singapore: {
    name: 'Marina Bay Street Circuit',
    country: 'Singapore',
    flag: '🇸🇬',
    city: 'Singapore',
    length_km: 4.940,
    turns: 19,
    lap_record: { time: '1:35.867', driver: 'Kevin Magnussen', year: 2018, car: 'Haas VF-18' },
    drs_zones: 3,
    category: ['F1'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Singapore_Circuit.png',
    notable: 'Night Race, Anderson Bridge, Turn 18',
    elevation_diff_m: 4,
    weather_city: 'Singapore,SG',
  },
  cota: {
    name: 'Circuit of The Americas',
    country: 'USA',
    flag: '🇺🇸',
    city: 'Austin, TX',
    length_km: 5.513,
    turns: 20,
    lap_record: { time: '1:36.169', driver: 'Charles Leclerc', year: 2019, car: 'Ferrari SF90' },
    drs_zones: 2,
    category: ['F1', 'MotoGP', 'GT3', 'IMSA'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/USA_Circuit.png',
    notable: 'Turn 1 Blind Crest, Esses, Back Straight',
    elevation_diff_m: 40,
    weather_city: 'Austin,US',
  },
  bahrain: {
    name: 'Bahrain International Circuit',
    country: 'Bahrain',
    flag: '🇧🇭',
    city: 'Sakhir',
    length_km: 5.412,
    turns: 15,
    lap_record: { time: '1:31.447', driver: 'Pedro de la Rosa', year: 2005, car: 'McLaren MP4/20' },
    drs_zones: 3,
    category: ['F1', 'GT3', 'Formula E'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Bahrain_Circuit.png',
    notable: 'Turn 4, Turn 10 hairpin, Night Race possible',
    elevation_diff_m: 3,
    weather_city: 'Sakhir,BH',
  },
  lemans: {
    name: 'Circuit de la Sarthe (Le Mans)',
    country: 'France',
    flag: '🇫🇷',
    city: 'Le Mans',
    length_km: 13.626,
    turns: 38,
    lap_record: { time: '3:14.791', driver: 'Kamui Kobayashi', year: 2017, car: 'Toyota TS050 Hybrid' },
    drs_zones: 0,
    category: ['WEC', 'Endurance', 'GT3', 'GTE'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Le_Mans_track_map.svg/800px-Le_Mans_track_map.svg.png',
    notable: 'Mulsanne Straight, Porsche Curves, Ford Chicanes',
    elevation_diff_m: 67,
    weather_city: 'Le Mans,FR',
  },
  laguna_seca: {
    name: 'WeatherTech Raceway Laguna Seca',
    country: 'USA',
    flag: '🇺🇸',
    city: 'Salinas, CA',
    length_km: 3.602,
    turns: 11,
    lap_record: { time: '1:07.012', driver: 'Oliver Askew', year: 2020, car: 'Indy Lights' },
    drs_zones: 0,
    category: ['IMSA', 'GT3', 'MotoGP', 'IndyCar'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Laguna_Seca_track_map.svg/800px-Laguna_Seca_track_map.svg.png',
    notable: 'The Corkscrew (Turn 8A/8B)',
    elevation_diff_m: 61,
    weather_city: 'Salinas,US',
  },
  watkins_glen: {
    name: 'Watkins Glen International',
    country: 'USA',
    flag: '🇺🇸',
    city: 'Watkins Glen, NY',
    length_km: 5.435,
    turns: 11,
    lap_record: { time: '1:22.767', driver: 'Sébastien Bourdais', year: 2015, car: 'Corvette DP' },
    drs_zones: 0,
    category: ['IMSA', 'GT3', 'NASCAR', 'IndyCar'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Watkins_Glen_track_map.svg/800px-Watkins_Glen_track_map.svg.png',
    notable: 'The Boot, Esses, Toe of The Boot',
    elevation_diff_m: 73,
    weather_city: 'Watkins Glen,US',
  },
  paul_ricard: {
    name: 'Circuit Paul Ricard',
    country: 'France',
    flag: '🇫🇷',
    city: 'Le Castellet',
    length_km: 5.842,
    turns: 15,
    lap_record: { time: '1:32.740', driver: 'Sebastian Vettel', year: 2019, car: 'Ferrari SF90' },
    drs_zones: 2,
    category: ['F1', 'GT3', 'WEC'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/France_Circuit.png',
    notable: 'Mistral Straight, Signes, Le Beausset',
    elevation_diff_m: 26,
    weather_city: 'Le Castellet,FR',
  },
  sepang: {
    name: 'Sepang International Circuit',
    country: 'Malaysia',
    flag: '🇲🇾',
    city: 'Sepang',
    length_km: 5.543,
    turns: 15,
    lap_record: { time: '1:34.223', driver: 'Juan Pablo Montoya', year: 2004, car: 'Williams FW26' },
    drs_zones: 2,
    category: ['F1', 'MotoGP', 'GT3'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Sepang_track_map.svg/800px-Sepang_track_map.svg.png',
    notable: 'Turn 1-2, Back Straight, Long Right-Handers',
    elevation_diff_m: 12,
    weather_city: 'Sepang,MY',
  },
  hungaroring: {
    name: 'Hungaroring',
    country: 'Hungary',
    flag: '🇭🇺',
    city: 'Budapest',
    length_km: 4.381,
    turns: 14,
    lap_record: { time: '1:16.627', driver: 'Lewis Hamilton', year: 2020, car: 'Mercedes W11' },
    drs_zones: 1,
    category: ['F1', 'GT3', 'DTM'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Hungary_Circuit.png',
    notable: 'Turn 4 hairpin, Turn 11, Monaco without walls',
    elevation_diff_m: 36,
    weather_city: 'Budapest,HU',
  },
  barcelona: {
    name: 'Circuit de Barcelona-Catalunya',
    country: 'Spain',
    flag: '🇪🇸',
    city: 'Montmeló',
    length_km: 4.657,
    turns: 16,
    lap_record: { time: '1:18.149', driver: 'Max Verstappen', year: 2021, car: 'Red Bull RB16B' },
    drs_zones: 2,
    category: ['F1', 'MotoGP', 'GT3', 'WTCR'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Spain_Circuit.png',
    notable: 'Turn 3, Turn 9 (La Caixa), Chicane',
    elevation_diff_m: 31,
    weather_city: 'Montmeló,ES',
  },
  portimao: {
    name: 'Autodromo Internacional do Algarve',
    country: 'Portugal',
    flag: '🇵🇹',
    city: 'Portimão',
    length_km: 4.653,
    turns: 15,
    lap_record: { time: '1:18.750', driver: 'Lewis Hamilton', year: 2020, car: 'Mercedes W11' },
    drs_zones: 3,
    category: ['F1', 'MotoGP', 'GT3', 'WSBK'],
    image_url: 'https://www.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Portugal_Circuit.png',
    notable: 'Blind crests, Turn 5 downhill, Roller Coaster section',
    elevation_diff_m: 104,
    weather_city: 'Portimão,PT',
  },
  jerez: {
    name: 'Circuito de Jerez - Ángel Nieto',
    country: 'Spain',
    flag: '🇪🇸',
    city: 'Jerez de la Frontera',
    length_km: 4.428,
    turns: 13,
    lap_record: { time: '1:23.596', driver: 'Michael Schumacher', year: 1997, car: 'Ferrari F310B' },
    drs_zones: 1,
    category: ['MotoGP', 'WSBK', 'GT3', 'F2'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Jerez_Circuit_map.svg/800px-Jerez_Circuit_map.svg.png',
    notable: 'Curva Expo, Chicane, Peluqui',
    elevation_diff_m: 18,
    weather_city: 'Jerez de la Frontera,ES',
  },
  mugello: {
    name: 'Autodromo Internazionale del Mugello',
    country: 'Italy',
    flag: '🇮🇹',
    city: 'Scarperia',
    length_km: 5.245,
    turns: 15,
    lap_record: { time: '1:17.602', driver: 'Kimi Räikkönen', year: 2020, car: 'Ferrari SF1000' },
    drs_zones: 1,
    category: ['F1', 'MotoGP', 'GT3'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Mugello_track_map.svg/800px-Mugello_track_map.svg.png',
    notable: 'Arrabbiata 1 & 2, San Donato, Bucine',
    elevation_diff_m: 60,
    weather_city: 'Scarperia,IT',
  },
  misano: {
    name: 'Misano World Circuit Marco Simoncelli',
    country: 'Italy',
    flag: '🇮🇹',
    city: 'Misano Adriatico',
    length_km: 4.226,
    turns: 16,
    lap_record: { time: '1:32.265', driver: 'Jorge Lorenzo', year: 2013, car: 'Yamaha YZR-M1' },
    drs_zones: 0,
    category: ['MotoGP', 'WSBK', 'GT3'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Misano_World_Circuit_track_map.svg/800px-Misano_World_Circuit_track_map.svg.png',
    notable: 'Tamburello, Quercia, Rio',
    elevation_diff_m: 7,
    weather_city: 'Misano Adriatico,IT',
  },
  daytona: {
    name: 'Daytona International Speedway',
    country: 'USA',
    flag: '🇺🇸',
    city: 'Daytona Beach, FL',
    length_km: 4.023,
    turns: 12,
    lap_record: { time: '0:40.364', driver: 'Bill Elliott', year: 1987, car: 'Ford Thunderbird' },
    drs_zones: 0,
    category: ['NASCAR', 'IMSA', 'Endurance'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Daytona_road_course.svg/800px-Daytona_road_course.svg.png',
    notable: 'Tri-oval, Daytona 500, 24h of Daytona',
    elevation_diff_m: 5,
    weather_city: 'Daytona Beach,US',
  },
  bathurst: {
    name: 'Mount Panorama Circuit',
    country: 'Australia',
    flag: '🇦🇺',
    city: 'Bathurst',
    length_km: 6.213,
    turns: 23,
    lap_record: { time: '2:03.837', driver: 'Scott McLaughlin', year: 2019, car: 'Ford Mustang Supercar' },
    drs_zones: 0,
    category: ['Supercars', 'GT3', 'Endurance'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Bathurst_track_map.svg/800px-Bathurst_track_map.svg.png',
    notable: 'Mountain section, Hell Corner, The Dipper, Conrod Straight',
    elevation_diff_m: 174,
    weather_city: 'Bathurst,AU',
  },
  fuji: {
    name: 'Fuji Speedway',
    country: 'Japan',
    flag: '🇯🇵',
    city: 'Oyama',
    length_km: 4.563,
    turns: 16,
    lap_record: { time: '1:28.193', driver: 'Kimi Räikkönen', year: 2007, car: 'Ferrari F2007' },
    drs_zones: 1,
    category: ['WEC', 'Super GT', 'GT3'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Fuji_speedway_track_map.svg/800px-Fuji_speedway_track_map.svg.png',
    notable: 'Long back straight, 100R, Mt. Fuji backdrop',
    elevation_diff_m: 18,
    weather_city: 'Oyama,JP',
  },
  snetterton: {
    name: 'Snetterton Circuit',
    country: 'United Kingdom',
    flag: '🇬🇧',
    city: 'Norwich',
    length_km: 4.779,
    turns: 13,
    lap_record: { time: '1:52.498', driver: 'Jack Goff', year: 2018, car: 'Honda Civic (BTCC)' },
    drs_zones: 0,
    category: ['BTCC', 'GT3', 'Superbike'],
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Snetterton_Circuit_300_track_map.svg/800px-Snetterton_Circuit_300_track_map.svg.png',
    notable: 'Bomb Hole, Coram Curve, Russell',
    elevation_diff_m: 12,
    weather_city: 'Norwich,GB',
  },
};

//--------------------------------------------------
//           ALIAS MAP (query → key)
//--------------------------------------------------

const ALIASES = {
  'spa': 'spa',
  'spa-francorchamps': 'spa',
  'francorchamps': 'spa',
  'monza': 'monza',
  'silverstone': 'silverstone',
  'suzuka': 'suzuka',
  'nurburgring': 'nurburgring',
  'nürburgring': 'nurburgring',
  'nurburg': 'nurburgring',
  'nordschleife': 'nordschleife',
  'green hell': 'nordschleife',
  'green_hell': 'nordschleife',
  'monaco': 'monaco',
  'monte carlo': 'monaco',
  'imola': 'imola',
  'interlagos': 'interlagos',
  'sao paulo': 'interlagos',
  'saopaulo': 'interlagos',
  'são paulo': 'interlagos',
  'saopablo': 'interlagos',
  'san paulo': 'interlagos',
  'jose carlos pace': 'interlagos',
  'redbullring': 'redbullring',
  'red bull ring': 'redbullring',
  'rbr': 'redbullring',
  'spielberg': 'redbullring',
  'zandvoort': 'zandvoort',
  'singapore': 'singapore',
  'marina bay': 'singapore',
  'cota': 'cota',
  'austin': 'cota',
  'circuit of the americas': 'cota',
  'bahrain': 'bahrain',
  'sakhir': 'bahrain',
  'le mans': 'lemans',
  'lemans': 'lemans',
  'laguna seca': 'laguna_seca',
  'lagunaseca': 'laguna_seca',
  'watkins glen': 'watkins_glen',
  'watkinsglen': 'watkins_glen',
  'paul ricard': 'paul_ricard',
  'ricard': 'paul_ricard',
  'sepang': 'sepang',
  'hungaroring': 'hungaroring',
  'budapest': 'hungaroring',
  'barcelona': 'barcelona',
  'catalunya': 'barcelona',
  'portimao': 'portimao',
  'portimão': 'portimao',
  'algarve': 'portimao',
  'jerez': 'jerez',
  'mugello': 'mugello',
  'misano': 'misano',
  'daytona': 'daytona',
  'bathurst': 'bathurst',
  'mount panorama': 'bathurst',
  'fuji': 'fuji',
  'fuji speedway': 'fuji',
  'snetterton': 'snetterton',
};

//--------------------------------------------------
//              WEATHER FETCH (wttr.in)
//--------------------------------------------------

async function getWeather(city) {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data.current_condition?.[0];
    if (!cur) return null;
    return {
      temp_c: cur.temp_C,
      feels_c: cur.FeelsLikeC,
      desc: cur.weatherDesc?.[0]?.value ?? 'Unknown',
      humidity: cur.humidity,
      wind_kmph: cur.windspeedKmph,
      visibility_km: cur.visibility,
    };
  } catch {
    return null;
  }
}

//--------------------------------------------------
//              IMAGE URL VALIDATOR
//--------------------------------------------------
// Discord bazen bazı URL'leri embed'de göstermez.
// Bunu önlemek için URL'yi HEAD isteğiyle kontrol edip
// content-type image/* ise kullan, değilse null dön.

async function resolveImage(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && ct.startsWith('image/')) return url;
    return null;
  } catch {
    return null;
  }
}

//--------------------------------------------------
//                    COMMAND
//--------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('track')
    .setDescription('Get detailed info about any motorsport circuit.')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Circuit name (e.g. spa, monza, nurburgring, lemans…)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString('name').toLowerCase().trim();
    const key = ALIASES[query] ?? Object.keys(TRACKS).find(k => k.includes(query));

    //-- Not found ──────────────────────────────
    if (!key || !TRACKS[key]) {
      const samples = [
        'spa', 'monza', 'silverstone', 'suzuka', 'nurburgring',
        'nordschleife', 'monaco', 'imola', 'interlagos', 'lemans',
        'cota', 'bahrain', 'bathurst', 'fuji', 'daytona',
      ].join(', ');

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Circuit Not Found')
            .setDescription(
              `No circuit matched **"${query}"**.\n\n**Available:** \`${samples}\`…`
            ),
        ],
      });
    }

    const t = TRACKS[key];

    //-- Parallel fetch: weather + image check ──
    const [weather, validImage] = await Promise.all([
      getWeather(t.weather_city),
      resolveImage(t.image_url),
    ]);

    //-- Weather field ──────────────────────────
    let weatherText;
    if (weather) {
      weatherText =
        `🌡️ **${weather.temp_c}°C** (feels ${weather.feels_c}°C)\n` +
        `☁️ ${weather.desc}\n` +
        `💧 Humidity: ${weather.humidity}%\n` +
        `💨 Wind: ${weather.wind_kmph} km/h\n` +
        `👁️ Visibility: ${weather.visibility_km} km`;
    } else {
      weatherText = '*Weather data unavailable.*';
    }

    //-- Category badges ────────────────────────
    const categories = t.category.map(c => `\`${c}\``).join(' ');

    //-- Build embed ────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(0x0c9978)
      .setTitle(`${t.flag}  ${t.name}`)
      .setDescription(`${categories}\n📍 ${t.city}, ${t.country}`)
      .addFields(
        {
          name: '📐 Circuit Stats',
          value:
            `> **Length:** ${t.length_km.toFixed(3)} km\n` +
            `> **Turns:** ${t.turns}\n` +
            `> **Elevation Δ:** ${t.elevation_diff_m} m` +
            (t.drs_zones > 0 ? `\n> **DRS Zones:** ${t.drs_zones}` : ''),
          inline: true,
        },
        {
          name: '⏱️ Lap Record',
          value:
            `> **Time:** ${t.lap_record.time}\n` +
            `> **Driver:** ${t.lap_record.driver}\n` +
            `> **Car:** ${t.lap_record.car}\n` +
            `> **Year:** ${t.lap_record.year}`,
          inline: true,
        },
        {
          name: '\u200B',
          value: '\u200B',
          inline: false,
        },
        {
          name: '🏁 Notable Corners',
          value: t.notable,
          inline: false,
        },
        {
          name: `🌤️ Current Weather — ${t.city}`,
          value: weatherText,
          inline: false,
        }
      )
      .setFooter({ text: '/track' })
      .setTimestamp();

    //-- Resim varsa ekle ───────────────────────
    if (validImage) {
      embed.setImage(validImage);
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

#!/usr/bin/env node
// Generate the Philippine civics + geography reference facts (PH_CIVICS,
// PH_GEOGRAPHY) and write them to rag/bank/ph-reference.generated.jsonl.
//
// WHY a generator: the 82 provinces + 18 regions are highly templated, so
// emitting them from a single verified table guarantees no per-record typos and
// makes the set regenerable when the political map changes (it does — Maguindanao
// split in 2021, Negros Island Region returned in 2024). The verbatim artifacts
// (anthem, pledge, prayers, flag, constitution) are authored explicitly below.
//
// Data verified 2026-06 against PSA/Wikipedia: 18 regions, 82 provinces. Sulu is
// listed under Region IX following the 2024 ruling removing it from BARMM.
//
//   node rag/scripts/gen-ph-reference.mjs
// then merge into the bank with rag/scripts/merge-ph-reference.py
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'bank', 'ph-reference.generated.jsonl');

const out = [];
const push = (f) => out.push({ generator: 'claude', reviewed: false, ...f });

// ---- helpers ---------------------------------------------------------------
const slug = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toks = (...parts) => {
  const seen = new Set();
  for (const p of parts.join(' ').toLowerCase().split(/[^a-z0-9ñ]+/i)) {
    if (p.length > 2) seen.add(p);
  }
  return [...seen];
};

// ---- regions ---------------------------------------------------------------
// code -> { name, island group (TL term), regional center }
const REGIONS = {
  NCR:       { name: 'National Capital Region',  tlName: 'Pambansang Punong Rehiyon (Kalakhang Maynila)', group: 'Luzon', center: 'Manila' },
  CAR:       { name: 'Cordillera Administrative Region', tlName: 'Cordillera Administrative Region', group: 'Luzon', center: 'Baguio' },
  I:         { name: 'Ilocos Region',            tlName: 'Rehiyon ng Ilocos', group: 'Luzon', center: 'San Fernando, La Union' },
  II:        { name: 'Cagayan Valley',           tlName: 'Lambak ng Cagayan', group: 'Luzon', center: 'Tuguegarao' },
  III:       { name: 'Central Luzon',            tlName: 'Gitnang Luzon', group: 'Luzon', center: 'San Fernando, Pampanga' },
  'IV-A':    { name: 'CALABARZON',               tlName: 'CALABARZON', group: 'Luzon', center: 'Calamba' },
  Mimaropa:  { name: 'Mimaropa',                 tlName: 'Mimaropa (Timog-Kanlurang Tagalog)', group: 'Luzon', center: 'Calapan' },
  V:         { name: 'Bicol Region',             tlName: 'Rehiyon ng Bicol', group: 'Luzon', center: 'Legazpi' },
  VI:        { name: 'Western Visayas',          tlName: 'Kanlurang Visayas', group: 'Visayas', center: 'Iloilo City' },
  VII:       { name: 'Central Visayas',          tlName: 'Gitnang Visayas', group: 'Visayas', center: 'Cebu City' },
  VIII:      { name: 'Eastern Visayas',          tlName: 'Silangang Visayas', group: 'Visayas', center: 'Tacloban' },
  NIR:       { name: 'Negros Island Region',     tlName: 'Negros Island Region', group: 'Visayas', center: 'Bacolod' },
  IX:        { name: 'Zamboanga Peninsula',      tlName: 'Tangway ng Zamboanga', group: 'Mindanao', center: 'Pagadian' },
  X:         { name: 'Northern Mindanao',        tlName: 'Hilagang Mindanao', group: 'Mindanao', center: 'Cagayan de Oro' },
  XI:        { name: 'Davao Region',             tlName: 'Rehiyon ng Davao', group: 'Mindanao', center: 'Davao City' },
  XII:       { name: 'SOCCSKSARGEN',             tlName: 'SOCCSKSARGEN', group: 'Mindanao', center: 'Koronadal' },
  XIII:      { name: 'Caraga',                   tlName: 'Caraga', group: 'Mindanao', center: 'Butuan' },
  BARMM:     { name: 'Bangsamoro Autonomous Region in Muslim Mindanao', tlName: 'Bangsamoro (BARMM)', group: 'Mindanao', center: 'Cotabato City' },
};
const GROUP_BIS = { Luzon: 'Luzon', Visayas: 'Visayas', Mindanao: 'Mindanao' };

// ---- provinces: [name, regionCode, capital] (82) ---------------------------
const PROVINCES = [
  ['Abra', 'CAR', 'Bangued'], ['Agusan del Norte', 'XIII', 'Cabadbaran'], ['Agusan del Sur', 'XIII', 'Prosperidad'],
  ['Aklan', 'VI', 'Kalibo'], ['Albay', 'V', 'Legazpi'], ['Antique', 'VI', 'San Jose de Buenavista'],
  ['Apayao', 'CAR', 'Kabugao'], ['Aurora', 'III', 'Baler'], ['Basilan', 'BARMM', 'Lamitan'],
  ['Bataan', 'III', 'Balanga'], ['Batanes', 'II', 'Basco'], ['Batangas', 'IV-A', 'Batangas City'],
  ['Benguet', 'CAR', 'La Trinidad'], ['Biliran', 'VIII', 'Naval'], ['Bohol', 'VII', 'Tagbilaran'],
  ['Bukidnon', 'X', 'Malaybalay'], ['Bulacan', 'III', 'Malolos'], ['Cagayan', 'II', 'Tuguegarao'],
  ['Camarines Norte', 'V', 'Daet'], ['Camarines Sur', 'V', 'Pili'], ['Camiguin', 'X', 'Mambajao'],
  ['Capiz', 'VI', 'Roxas City'], ['Catanduanes', 'V', 'Virac'], ['Cavite', 'IV-A', 'Imus'],
  ['Cebu', 'VII', 'Cebu City'], ['Cotabato', 'XII', 'Kidapawan'], ['Davao de Oro', 'XI', 'Nabunturan'],
  ['Davao del Norte', 'XI', 'Tagum'], ['Davao del Sur', 'XI', 'Digos'], ['Davao Occidental', 'XI', 'Malita'],
  ['Davao Oriental', 'XI', 'Mati'], ['Dinagat Islands', 'XIII', 'San Jose'], ['Eastern Samar', 'VIII', 'Borongan'],
  ['Guimaras', 'VI', 'Jordan'], ['Ifugao', 'CAR', 'Lagawe'], ['Ilocos Norte', 'I', 'Laoag'],
  ['Ilocos Sur', 'I', 'Vigan'], ['Iloilo', 'VI', 'Iloilo City'], ['Isabela', 'II', 'Ilagan'],
  ['Kalinga', 'CAR', 'Tabuk'], ['La Union', 'I', 'San Fernando'], ['Laguna', 'IV-A', 'Santa Cruz'],
  ['Lanao del Norte', 'X', 'Tubod'], ['Lanao del Sur', 'BARMM', 'Marawi'], ['Leyte', 'VIII', 'Tacloban'],
  ['Maguindanao del Norte', 'BARMM', 'Datu Odin Sinsuat'], ['Maguindanao del Sur', 'BARMM', 'Buluan'],
  ['Marinduque', 'Mimaropa', 'Boac'], ['Masbate', 'V', 'Masbate City'], ['Misamis Occidental', 'X', 'Oroquieta'],
  ['Misamis Oriental', 'X', 'Cagayan de Oro'], ['Mountain Province', 'CAR', 'Bontoc'],
  ['Negros Occidental', 'NIR', 'Bacolod'], ['Negros Oriental', 'NIR', 'Dumaguete'], ['Northern Samar', 'VIII', 'Catarman'],
  ['Nueva Ecija', 'III', 'Palayan'], ['Nueva Vizcaya', 'II', 'Bayombong'], ['Occidental Mindoro', 'Mimaropa', 'Mamburao'],
  ['Oriental Mindoro', 'Mimaropa', 'Calapan'], ['Palawan', 'Mimaropa', 'Puerto Princesa'], ['Pampanga', 'III', 'San Fernando'],
  ['Pangasinan', 'I', 'Lingayen'], ['Quezon', 'IV-A', 'Lucena'], ['Quirino', 'II', 'Cabarroguis'],
  ['Rizal', 'IV-A', 'Antipolo'], ['Romblon', 'Mimaropa', 'Romblon'], ['Samar', 'VIII', 'Catbalogan'],
  ['Sarangani', 'XII', 'Alabel'], ['Siquijor', 'NIR', 'Siquijor'], ['Sorsogon', 'V', 'Sorsogon City'],
  ['South Cotabato', 'XII', 'Koronadal'], ['Southern Leyte', 'VIII', 'Maasin'], ['Sultan Kudarat', 'XII', 'Isulan'],
  ['Sulu', 'IX', 'Jolo'], ['Surigao del Norte', 'XIII', 'Surigao City'], ['Surigao del Sur', 'XIII', 'Tandag'],
  ['Tarlac', 'III', 'Tarlac City'], ['Tawi-Tawi', 'BARMM', 'Bongao'], ['Zambales', 'III', 'Iba'],
  ['Zamboanga del Norte', 'IX', 'Dipolog'], ['Zamboanga del Sur', 'IX', 'Pagadian'], ['Zamboanga Sibugay', 'IX', 'Ipil'],
];

// ---- province facts --------------------------------------------------------
for (const [name, code, capital] of PROVINCES) {
  const r = REGIONS[code];
  push({
    id: `ph-prov-${slug(name)}`,
    domain: 'PH_GEOGRAPHY',
    topic: `${name} province`,
    grades: [4, 5, 6, 7],
    terms: toks(name, capital, r.name, code, 'lalawigan probinsya province kabisera kaulohan capital rehiyon region', r.group),
    fact: {
      tl: `Ang ${name} ay isang lalawigan (probinsya) ng Pilipinas sa rehiyon ng ${r.name} (${code}), na bahagi ng ${r.group}. Ang kabisera nito ay ${capital}.`,
      en: `${name} is a province of the Philippines in the ${r.name} region (${code}), part of ${r.group}. Its capital is ${capital}.`,
      bis: `Ang ${name} usa ka probinsya (lalawigan) sa Pilipinas sa rehiyon sa ${r.name} (${code}), nga bahin sa ${GROUP_BIS[r.group]}. Ang kaulohan niini mao ang ${capital}.`,
    },
    source: 'PSA PSGC; Republic Act province charters',
  });
}

// ---- region facts ----------------------------------------------------------
const provByRegion = {};
for (const [name, code] of PROVINCES) (provByRegion[code] ||= []).push(name);

for (const [code, r] of Object.entries(REGIONS)) {
  const provs = provByRegion[code] || [];
  const n = provs.length;
  let tlClause, enClause, bisClause;
  if (code === 'NCR') {
    tlClause = `Wala itong lalawigan — binubuo ito ng 16 na lungsod at isang bayan (Pateros). Dito matatagpuan ang Maynila, ang kabisera ng Pilipinas.`;
    enClause = `It has no provinces — it is made up of 16 cities and one municipality (Pateros). Manila, the capital of the Philippines, is here.`;
    bisClause = `Wala kini probinsya — gilangkoban kini sa 16 ka siyudad ug usa ka lungsod (Pateros). Naa dinhi ang Manila, ang kaulohan sa Pilipinas.`;
  } else {
    const list = provs.join(', ');
    tlClause = `Binubuo ito ng ${n} na lalawigan: ${list}.`;
    enClause = `It is made up of ${n} provinces: ${list}.`;
    bisClause = `Gilangkoban kini sa ${n} ka probinsya: ${list}.`;
  }
  push({
    id: `ph-region-${slug(code)}`,
    domain: 'PH_GEOGRAPHY',
    topic: `${r.name} region`,
    grades: [4, 5, 6, 7],
    terms: toks(r.name, r.tlName, code, 'rehiyon region', r.group, r.center, ...provs),
    fact: {
      tl: `Ang ${r.name} (${code}) ay isa sa 18 rehiyon ng Pilipinas, matatagpuan sa ${r.group}. ${tlClause} Ang sentrong rehiyonal nito ay ${r.center}.`,
      en: `${r.name} (${code}) is one of the 18 regions of the Philippines, located in ${r.group}. ${enClause} Its regional center is ${r.center}.`,
      bis: `Ang ${r.name} (${code}) usa sa 18 ka rehiyon sa Pilipinas, nahimutang sa ${GROUP_BIS[r.group]}. ${bisClause} Ang sentro nga rehiyonal niini mao ang ${r.center}.`,
    },
    source: 'PSA PSGC; Executive Orders / RA 12000 (NIR)',
  });
}

// ---- national geography overview ------------------------------------------
push({
  id: 'ph-overview-regions-provinces', domain: 'PH_GEOGRAPHY', topic: 'regions and provinces of the Philippines',
  grades: [3, 4, 5, 6, 7],
  terms: toks('ilan rehiyon lalawigan probinsya region province bilang pilipinas philippines 18 82 ehiya'),
  fact: {
    tl: 'Ang Pilipinas ay nahahati sa 18 na rehiyon (region) at 82 na lalawigan (province). Ang mga lalawigan ay binubuo ng mga lungsod at bayan (munisipalidad).',
    en: 'The Philippines is divided into 18 regions and 82 provinces. Provinces are made up of cities and municipalities (towns).',
    bis: 'Ang Pilipinas gibahin sa 18 ka rehiyon (region) ug 82 ka probinsya (province). Ang mga probinsya gilangkoban sa mga siyudad ug lungsod (munisipyo).',
  },
  source: 'PSA PSGC (2025)',
});
push({
  id: 'ph-island-groups', domain: 'PH_GEOGRAPHY', topic: 'three island groups of the Philippines',
  grades: [3, 4, 5, 6],
  terms: toks('luzon visayas mindanao pangkat pulo island group tatlong tatlo tulo isla kapuluan'),
  fact: {
    tl: 'May tatlong pangunahing pangkat-pulo ang Pilipinas: Luzon sa hilaga, Visayas sa gitna, at Mindanao sa timog.',
    en: 'The Philippines has three main island groups: Luzon in the north, the Visayas in the center, and Mindanao in the south.',
    bis: 'Ang Pilipinas adunay tulo ka nag-unang pundok sa kapuluan: Luzon sa amihanan, Visayas sa tunga, ug Mindanao sa habagatan.',
  },
  source: 'PSA',
});
push({
  id: 'ph-capital-manila', domain: 'PH_GEOGRAPHY', topic: 'capital of the Philippines',
  grades: [3, 4, 5, 6],
  terms: toks('kabisera kaulohan capital maynila manila metro ncr punong lungsod bansa pilipinas'),
  fact: {
    tl: 'Ang kabisera ng Pilipinas ay Maynila (Manila). Bahagi ito ng Metro Manila o National Capital Region (NCR), ang sentro ng pamahalaan at negosyo.',
    en: "The capital of the Philippines is Manila. It is part of Metro Manila, or the National Capital Region (NCR), the center of government and business.",
    bis: 'Ang kaulohan sa Pilipinas mao ang Manila. Bahin kini sa Metro Manila o National Capital Region (NCR), ang sentro sa gobyerno ug negosyo.',
  },
  source: 'PSA',
});
push({
  id: 'ph-number-of-islands', domain: 'PH_GEOGRAPHY', topic: 'number of islands in the Philippines',
  grades: [3, 4, 5, 6],
  terms: toks('ilan isla island bilang pilipinas philippines 7641 kapuluan archipelago pulo'),
  fact: {
    tl: 'Ang Pilipinas ay isang kapuluan na may humigit-kumulang 7,641 na isla. Kaya tinatawag itong "Pearl of the Orient Seas."',
    en: 'The Philippines is an archipelago of about 7,641 islands. That is why it is called the "Pearl of the Orient Seas."',
    bis: 'Ang Pilipinas usa ka kapupud-an nga adunay mga 7,641 ka isla. Mao nga gitawag kini nga "Pearl of the Orient Seas."',
  },
  source: 'NAMRIA (2016)',
});

// ===========================================================================
// PH_CIVICS — verbatim national artifacts + symbols
// ===========================================================================

// --- Lupang Hinirang (national anthem), full official Filipino lyrics -------
const ANTHEM_TL = [
  'Bayang magiliw, Perlas ng silanganan,',
  'Alab ng puso, sa dibdib mo\'y buhay.',
  'Lupang hinirang, duyan ka ng magiting,',
  'Sa manlulupig, di ka pasisiil.',
  'Sa dagat at bundok, sa simoy at sa langit mong bughaw,',
  'May dilag ang tula at awit sa paglayang minamahal.',
  'Ang kislap ng watawat mo\'y tagumpay na nagniningning;',
  'Ang bituin at araw niya kailan pa ma\'y di magdidilim.',
  'Lupa ng araw, ng luwalhati\'t pagsinta,',
  'Buhay ay langit sa piling mo;',
  'Aming ligaya na \'pag may mang-aapi,',
  'Ang mamatay nang dahil sa \'yo.',
].join('\n');
push({
  id: 'ph-anthem-lupang-hinirang', domain: 'PH_CIVICS', topic: 'Lupang Hinirang national anthem lyrics',
  grades: [3, 4, 5, 6, 7],
  terms: toks('lupang hinirang pambansang awit national anthem himno kanta bayang magiliw perlas silanganan lyrics titik'),
  fact: {
    tl: `Ang "Lupang Hinirang" ang pambansang awit ng Pilipinas. Ito ang buong titik:\n${ANTHEM_TL}`,
    en: `"Lupang Hinirang" ("Chosen Land") is the national anthem of the Philippines. By law it is always sung in Filipino. The full Filipino lyrics are:\n${ANTHEM_TL}`,
    bis: `Ang "Lupang Hinirang" mao ang nasudnong awit sa Pilipinas. Kanunay kining ginakanta sa Filipino. Mao kini ang tibuok titik:\n${ANTHEM_TL}`,
  },
  source: 'Republic Act 8491 (Flag and Heraldic Code)',
});
push({
  id: 'ph-anthem-facts', domain: 'PH_CIVICS', topic: 'history of the national anthem',
  grades: [4, 5, 6, 7],
  terms: toks('lupang hinirang julian felipe jose palma filipinas himno musika tugtog kasaysayan composer 1898 awit'),
  fact: {
    tl: 'Ang musika ng "Lupang Hinirang" ay binuo ni Julian Felipe noong 1898. Ang titik ay mula sa tulang Espanyol na "Filipinas" ni Jose Palma, na isinalin sa Filipino. Dapat itong awitin nang may paggalang habang nakatayo.',
    en: 'The music of "Lupang Hinirang" was composed by Julian Felipe in 1898. The words came from a Spanish poem, "Filipinas," by Jose Palma, later translated into Filipino. It should be sung respectfully while standing.',
    bis: 'Ang musika sa "Lupang Hinirang" gihimo ni Julian Felipe niadtong 1898. Ang titik gikan sa Espanyol nga balak nga "Filipinas" ni Jose Palma, nga gihubad sa Filipino. Kinahanglan kining awiton nga may pagtahod samtang nagtindog.',
  },
  source: 'Republic Act 8491; National Historical Commission',
});

// --- Panatang Makabayan (2023 amended DepEd text) ---------------------------
const PANATA = [
  'Iniibig ko ang Pilipinas, aking lupang sinilangan,',
  'tahanan ng aking lahi; kinukupkop ako at tinutulungang',
  'maging malakas, masipag at marangal.',
  'Dahil mahal ko ang Pilipinas, diringgin ko ang payo',
  'ng aking mga magulang, susundin ko ang tuntunin ng paaralan,',
  'tutuparin ko ang tungkulin ng mamamayang makabayan:',
  'naglilingkod, nag-aaral, at nananalangin nang buong katapatan.',
  'Iaalay ko ang aking buhay, pangarap, pagsisikap sa bansang Pilipinas.',
].join('\n');
push({
  id: 'ph-panatang-makabayan', domain: 'PH_CIVICS', topic: 'Panatang Makabayan patriotic oath',
  grades: [3, 4, 5, 6, 7],
  terms: toks('panatang makabayan patriotic oath panata iniibig pilipinas lupang sinilangan paaralan flag ceremony'),
  fact: {
    tl: `Ang Panatang Makabayan ay binibigkas sa flag ceremony sa mga paaralan. Ito ang buong panata:\n${PANATA}`,
    en: `The Panatang Makabayan (Patriotic Oath) is recited at school flag ceremonies. The full oath in Filipino is:\n${PANATA}`,
    bis: `Ang Panatang Makabayan ginalitok sa flag ceremony sa mga eskwelahan. Mao kini ang tibuok panaad:\n${PANATA}`,
  },
  source: 'DepEd Order 54, s. 2001 (amended 2023)',
});

// --- Flag ------------------------------------------------------------------
push({
  id: 'ph-flag-colors', domain: 'PH_CIVICS', topic: 'meaning of the Philippine flag colors',
  grades: [3, 4, 5, 6],
  terms: toks('watawat bandila flag kulay color asul bughaw pula puti blue red white tatsulok triangle kahulugan kapayapaan katapangan'),
  fact: {
    tl: 'Tatlong kulay ng watawat ng Pilipinas: ang asul (royal blue) ay sumisimbolo sa kapayapaan, katotohanan, at katarungan; ang pula ay para sa pagkamakabayan at katapangan; ang puting tatsulok ay para sa pagkakapantay-pantay at kapatiran.',
    en: "The Philippine flag has three colors: royal blue stands for peace, truth, and justice; red stands for patriotism and valor; and the white triangle stands for equality and fraternity.",
    bis: 'Tulo ka kolor sa bandila sa Pilipinas: ang asul (royal blue) nagsimbolo sa kalinaw, kamatuoran, ug hustisya; ang pula para sa pagkamakabayan ug kaisog; ang puti nga triyanggulo para sa pagkaparehas ug panag-igsoonay.',
  },
  source: 'Republic Act 8491',
});
push({
  id: 'ph-flag-stars-sun', domain: 'PH_CIVICS', topic: 'meaning of the stars and sun on the Philippine flag',
  grades: [3, 4, 5, 6],
  terms: toks('watawat bandila flag bituin star araw sun sinag ray tatlo tatlong walo walong luzon visayas mindanao lalawigan kahulugan'),
  fact: {
    tl: 'Ang tatlong bituin sa watawat ay kumakatawan sa tatlong pangunahing pangkat-pulo: Luzon, Visayas, at Mindanao. Ang araw na may walong sinag ay para sa unang walong lalawigan na naghimagsik laban sa Espanya, at sumisimbolo sa kalayaan.',
    en: 'The three stars on the flag represent the three main island groups: Luzon, the Visayas, and Mindanao. The sun with eight rays stands for the first eight provinces that revolted against Spain, and symbolizes freedom.',
    bis: 'Ang tulo ka bituon sa bandila nagrepresentar sa tulo ka nag-unang pundok sa kapuluan: Luzon, Visayas, ug Mindanao. Ang adlaw nga adunay walo ka silaw para sa unang walo ka probinsya nga nag-alsa batok sa Espanya, ug nagsimbolo sa kagawasan.',
  },
  source: 'Republic Act 8491',
});
push({
  id: 'ph-flag-war-peace', domain: 'PH_CIVICS', topic: 'flag orientation war and peace',
  grades: [4, 5, 6, 7],
  terms: toks('watawat bandila flag pula asul itaas digmaan kapayapaan giyera war peace pataas baligtad orientation'),
  fact: {
    tl: 'Kakaiba ang watawat ng Pilipinas: kapag panahon ng kapayapaan, ang asul ang nasa itaas; kapag panahon ng digmaan, ang pula ang inilalagay sa itaas.',
    en: 'The Philippine flag is unique: in peacetime the blue stripe is on top; in wartime the red stripe is flown on top.',
    bis: 'Talagsaon ang bandila sa Pilipinas: sa panahon sa kalinaw, ang asul ang naa sa ibabaw; sa panahon sa gubat, ang pula ang ibutang sa ibabaw.',
  },
  source: 'Republic Act 8491',
});
push({
  id: 'ph-flag-history', domain: 'PH_CIVICS', topic: 'history of the Philippine flag',
  grades: [4, 5, 6, 7],
  terms: toks('watawat bandila flag kasaysayan marcela agoncillo june hunyo 12 1898 kawit cavite kalayaan tinahi independence'),
  fact: {
    tl: 'Ang unang watawat ng Pilipinas ay tinahi nina Marcela Agoncillo, kasama ang kanyang anak na si Lorenza at si Delfina Herbosa de Natividad, sa Hong Kong. Unang iwinagayway ito noong ipinahayag ang kalayaan sa Kawit, Cavite noong Hunyo 12, 1898.',
    en: 'The first Philippine flag was sewn by Marcela Agoncillo, with her daughter Lorenza and Delfina Herbosa de Natividad, in Hong Kong. It was first unfurled when independence was proclaimed in Kawit, Cavite on June 12, 1898.',
    bis: 'Ang unang bandila sa Pilipinas gitahi nila Marcela Agoncillo, kauban ang iyang anak nga si Lorenza ug si Delfina Herbosa de Natividad, sa Hong Kong. Una kining giwarawara sa pagmantala sa kagawasan sa Kawit, Cavite niadtong Hunyo 12, 1898.',
  },
  source: 'National Historical Commission of the Philippines',
});

// --- National symbols -------------------------------------------------------
const SYMBOLS = [
  ['flower', 'pambansang bulaklak', 'national flower', 'Sampaguita',
    'Ang pambansang bulaklak ng Pilipinas ay ang Sampaguita, isang maliit at mabangong puting bulaklak.',
    'The national flower of the Philippines is the Sampaguita, a small, fragrant white flower.',
    'Ang nasudnong bulak sa Pilipinas mao ang Sampaguita, usa ka gamay ug humot nga puti nga bulak.',
    'bulaklak flower sampaguita bango puti'],
  ['tree', 'pambansang puno', 'national tree', 'Narra',
    'Ang pambansang puno ng Pilipinas ay ang Narra, isang matibay at malaking puno.',
    'The national tree of the Philippines is the Narra, a strong, large hardwood tree.',
    'Ang nasudnong kahoy sa Pilipinas mao ang Narra, usa ka lig-on ug dako nga kahoy.',
    'puno tree narra kahoy matibay'],
  ['bird', 'pambansang ibon', 'national bird', 'Philippine Eagle (Agila)',
    'Ang pambansang ibon ng Pilipinas ay ang Philippine Eagle o Agila, isa sa pinakamalaking agila sa mundo at nanganganib nang maubos.',
    'The national bird of the Philippines is the Philippine Eagle, one of the largest eagles in the world and an endangered species.',
    'Ang nasudnong langgam sa Pilipinas mao ang Philippine Eagle o Agila, usa sa pinakadako nga agila sa kalibutan ug namiligro nga mahurot.',
    'ibon bird agila eagle langgam pambansang nanganganib'],
  ['language', 'pambansang wika', 'national language', 'Filipino',
    'Ang pambansang wika ng Pilipinas ay ang Filipino, na nakabatay sa Tagalog. Ang Ingles ay isa ring opisyal na wika.',
    'The national language of the Philippines is Filipino, based on Tagalog. English is also an official language.',
    'Ang nasudnong pinulongan sa Pilipinas mao ang Filipino, nga gibase sa Tagalog. Ang Iningles usa usab ka opisyal nga pinulongan.',
    'wika language filipino tagalog ingles opisyal pinulongan'],
  ['hero', 'pambansang bayani', 'national hero', 'Jose Rizal',
    'Itinuturing na pambansang bayani ng Pilipinas si Dr. Jose Rizal, na sumulat ng mga nobelang "Noli Me Tangere" at "El Filibusterismo" laban sa pang-aapi.',
    'Dr. Jose Rizal is regarded as the national hero of the Philippines; he wrote the novels "Noli Me Tangere" and "El Filibusterismo" against oppression.',
    'Si Dr. Jose Rizal giila nga nasudnong bayani sa Pilipinas; nagsulat siya sa mga nobela nga "Noli Me Tangere" ug "El Filibusterismo" batok sa pagpangdaugdaug.',
    'bayani hero jose rizal noli filibusterismo bayani'],
];
for (const [key, tlTopic, enTopic, name, tl, en, bis, extra] of SYMBOLS) {
  push({
    id: `ph-symbol-${key}`, domain: 'PH_CIVICS', topic: `${enTopic} of the Philippines`,
    grades: [3, 4, 5, 6],
    terms: toks(tlTopic, enTopic, name, 'pambansang national pilipinas philippines simbolo symbol', extra),
    fact: { tl, en, bis },
    source: 'Republic Act 8491 / national symbols',
  });
}

// --- 1987 Constitution ------------------------------------------------------
push({
  id: 'ph-constitution-preamble', domain: 'PH_CIVICS', topic: 'preamble of the 1987 Constitution',
  grades: [5, 6, 7],
  terms: toks('saligang batas constitution preamble panimula 1987 sambayanang pilipino sovereign people maykapal demokrasya'),
  fact: {
    tl: 'Ang Panimula (Preamble) ng 1987 Saligang Batas: "Kami, ang nakapangyayaring sambayanang Pilipino, na humihingi ng tulong sa Makapangyarihang Diyos, upang bumuo ng isang makatarungan at makataong lipunan at magtatag ng isang Pamahalaan na kakatawan sa aming mga mithiin at adhikain, magtataguyod ng kabutihan sa bawat isa, mangangalaga at magpapaunlad ng aming kabuhayan, at magbibigay sa amin at sa aming mga magiging anak ng mga biyaya ng kalayaan at demokrasya sa ilalim ng pananaig ng batas at ng pamamahalang puno ng katotohanan, katarungan, kalayaan, pagmamahalan, pagkakapantay-pantay, at kapayapaan, ay naghahayag at nagpapatibay ng Saligang Batas na ito."',
    en: 'The Preamble of the 1987 Constitution: "We, the sovereign Filipino people, imploring the aid of Almighty God, in order to build a just and humane society and establish a Government that shall embody our ideals and aspirations, promote the common good, conserve and develop our patrimony, and secure to ourselves and our posterity the blessings of independence and democracy under the rule of law and a regime of truth, justice, freedom, love, equality, and peace, do ordain and promulgate this Constitution."',
    bis: 'Ang Pasiuna (Preamble) sa 1987 nga Konstitusyon nag-ingon nga ang soberanong katawhang Pilipino, nga nangayog tabang sa Makagagahum nga Dios, magtukod og makatarunganon ug makitawhanon nga katilingban ug Gobyerno nga magtaguyod sa kaayohan sa tanan, ubos sa balaod ug sa kamatuoran, hustisya, kagawasan, gugma, pagkaparehas, ug kalinaw.',
  },
  source: '1987 Constitution of the Philippines, Preamble',
});
push({
  id: 'ph-government-branches', domain: 'PH_CIVICS', topic: 'three branches of the Philippine government',
  grades: [4, 5, 6, 7],
  terms: toks('pamahalaan gobyerno government sangay branch ehekutibo lehislatibo hudikatura executive legislative judicial pangulo president kongreso korte suprema'),
  fact: {
    tl: 'Tatlong sangay ng pamahalaan ng Pilipinas: ang Ehekutibo (pinamumunuan ng Pangulo, na nagpapatupad ng batas), ang Lehislatibo (ang Kongreso — Senado at Kapulungan ng mga Kinatawan, na gumagawa ng batas), at ang Hudikatura (ang mga korte, pangunguna ang Korte Suprema, na nagpapakahulugan ng batas).',
    en: 'The Philippine government has three branches: the Executive (led by the President, which carries out the laws), the Legislative (Congress — the Senate and House of Representatives, which makes the laws), and the Judicial (the courts, led by the Supreme Court, which interprets the laws).',
    bis: 'Tulo ka sanga sa gobyerno sa Pilipinas: ang Ehekutibo (gipangulohan sa Presidente, nga nagpatuman sa balaod), ang Lehislatibo (ang Kongreso — Senado ug Balay sa mga Representante, nga naghimo sa balaod), ug ang Hudikatura (ang mga korte, pinangulohan sa Korte Suprema, nga naghubad sa balaod).',
  },
  source: '1987 Constitution',
});
push({
  id: 'ph-president-term', domain: 'PH_CIVICS', topic: 'the President of the Philippines',
  grades: [4, 5, 6, 7],
  terms: toks('pangulo presidente president pinuno bansa termino anim taon halal eleksyon malacanang head of state'),
  fact: {
    tl: 'Ang Pangulo (President) ang pinuno ng bansa at ng sangay na Ehekutibo. Nahahalal siya sa loob ng anim (6) na taon at hindi na puwedeng muling tumakbo sa parehong posisyon. Nakatira ang Pangulo sa Malacañang.',
    en: 'The President is the head of state and of the Executive branch. The President is elected for a six (6) year term and cannot be re-elected to the same position. The President lives in Malacañang.',
    bis: 'Ang Presidente mao ang pangulo sa nasud ug sa sanga nga Ehekutibo. Mapili siya sulod sa unom (6) ka tuig ug dili na mahimong modagan pag-usab sa samang posisyon. Ang Presidente nagpuyo sa Malacañang.',
  },
  source: '1987 Constitution, Article VII',
});

// --- Common Catholic prayers (cultural/factual; trilingual) ------------------
const PRAYERS = [
  ['tanda-krus', 'Tanda ng Krus / Sign of the Cross',
    'Sa ngalan ng Ama, at ng Anak, at ng Espiritu Santo. Amen.',
    'In the name of the Father, and of the Son, and of the Holy Spirit. Amen.',
    'Sa ngalan sa Amahan, ug sa Anak, ug sa Espiritu Santo. Amen.',
    'tanda krus sign cross banal ngalan ama anak espiritu santo'],
  ['ama-namin', 'Ama Namin / Our Father (Lord\'s Prayer)',
    'Ama namin, sumasalangit Ka, sambahin ang ngalan Mo. Mapasaamin ang kaharian Mo, sundin ang loob Mo dito sa lupa para nang sa langit. Bigyan Mo kami ngayon ng aming kakanin sa araw-araw, at patawarin Mo kami sa aming mga sala, para nang pagpapatawad namin sa nagkakasala sa amin. At huwag Mo kaming ipahintulot sa tukso, at iadya Mo kami sa lahat ng masama. Amen.',
    'Our Father, who art in heaven, hallowed be thy name. Thy kingdom come, thy will be done, on earth as it is in heaven. Give us this day our daily bread, and forgive us our trespasses, as we forgive those who trespass against us. And lead us not into temptation, but deliver us from evil. Amen.',
    'Amahan namo, nga anaa ka sa mga langit, pagdaygon ang imong ngalan. Umabot kanamo ang imong gingharian, matuman ang imong pagbuot dinhi sa yuta maingon sa langit. Ang kalan-on namo sa matag-adlaw, ihatag kanamo karong adlawa, ug pasayloa kami sa among mga sala, ingon nga nagapasaylo kami sa mga nakasala kanamo. Ug dili mo kami itugyan sa mga panulay, hinonoa luwasa kami sa dautan. Amen.',
    'ama namin amahan namo our father panalangin pagdasal dasal panginoon langit'],
  ['aba-ginoong-maria', 'Aba Ginoong Maria / Hail Mary',
    'Aba Ginoong Maria, napupuno ka ng grasya, ang Panginoong Diyos ay sumasaiyo. Bukod kang pinagpala sa babaeng lahat, at pinagpala naman ang iyong Anak na si Hesus. Santa Maria, Ina ng Diyos, ipanalangin mo kaming makasalanan, ngayon at kung kami ay mamamatay. Amen.',
    'Hail Mary, full of grace, the Lord is with thee. Blessed art thou among women, and blessed is the fruit of thy womb, Jesus. Holy Mary, Mother of God, pray for us sinners, now and at the hour of our death. Amen.',
    'Maghimaya ka Maria, nga napuno ka sa grasya, ang Ginoong Dios anaa kanimo. Bulahan ka sa mga babaye nga tanan, ug bulahan man usab ang bunga sa imong tiyan nga si Hesus. Santa Maria, Inahan sa Dios, ig-ampo mo kaming mga makasasala, karon ug sa oras sa among kamatayon. Amen.',
    'aba ginoong maria hail mary maghimaya panalangin santa ina diyos'],
  ['luwalhati', 'Luwalhati sa Ama / Glory Be',
    'Luwalhati sa Ama, at sa Anak, at sa Espiritu Santo. Kapara noong unang-una, ngayon at magpakailanman, at magpasawalang-hanggan. Amen.',
    'Glory be to the Father, and to the Son, and to the Holy Spirit. As it was in the beginning, is now, and ever shall be, world without end. Amen.',
    'Himaya sa Amahan, ug sa Anak, ug sa Espiritu Santo. Maingon sa sinugdan, karon ug sa gihapon, hangtod sa kahangtoran. Amen.',
    'luwalhati himaya glory be ama anak espiritu santo doxology'],
];
for (const [key, topic, tl, en, bis, extra] of PRAYERS) {
  push({
    id: `ph-prayer-${key}`, domain: 'PH_CIVICS', topic,
    grades: [3, 4, 5, 6, 7],
    terms: toks(topic, 'panalangin dasal prayer ampo katoliko catholic', extra),
    fact: { tl, en, bis },
    source: 'Traditional Catholic prayer (Filipino)',
  });
}

// ---- write -----------------------------------------------------------------
writeFileSync(OUT, out.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
const byDomain = out.reduce((m, f) => ((m[f.domain] = (m[f.domain] || 0) + 1), m), {});
console.log(`wrote ${out.length} facts to ${OUT}`);
console.log(Object.entries(byDomain).map(([k, v]) => `  ${k}: ${v}`).join('\n'));

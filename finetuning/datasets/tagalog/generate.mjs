#!/usr/bin/env node
/**
 * Generator script for Tagalog science training dataset
 * Combines all domain dialogues into a single JSONL file
 */

import { writeFileSync } from 'fs';
import { matterDialogues } from './matter.mjs';
import { livingThingsDialogues } from './living-things.mjs';
import { forceMotionEnergyDialogues } from './force-motion-energy.mjs';
import { earthSpaceDialogues } from './earth-space.mjs';
import { environmentDialogues } from './environment.mjs';
import { authenticTeachingDialogues } from './authentic-teaching.mjs';
import { scienceFundamentalsDialogues } from './science-fundamentals.mjs';
import { biologyExpandedDialogues } from './biology-expanded.mjs';
import { chemistryExpandedDialogues } from './chemistry-expanded.mjs';
import { physicsExpandedDialogues } from './physics-expanded.mjs';
import { earthScienceExpandedDialogues } from './earth-science-expanded.mjs';
import { environmentExpandedDialogues } from './environment-expanded.mjs';
import { matterExpandedDialogues } from './matter-expanded.mjs';
import { grade34Dialogues } from './grade3-4-dialogues.mjs';
import { grade56Dialogues } from './grade5-6-dialogues.mjs';
import { grade78Dialogues } from './grade7-8-dialogues.mjs';
import { grade910Dialogues } from './grade9-10-dialogues.mjs';
import { practicalApplicationsDialogues } from './practical-applications-dialogues.mjs';
import { matterV2Dialogues } from './matter-v2.mjs';
import { biologyV2Dialogues } from './biology-v2.mjs';
import { earthWeatherV2Dialogues } from './earth-weather-v2.mjs';
import { physicsV2Dialogues } from './physics-v2.mjs';
import { chemistryV2Dialogues } from './chemistry-v2.mjs';
import { everydayPhV2Dialogues } from './everyday-ph-v2.mjs';
import { rhRedirectDialogues } from './rh-redirects.mjs';
import { qualityV3Dialogues } from './quality-v3.mjs';
import { biologyV3Dialogues } from './biology-v3.mjs';
import { environmentV3Dialogues } from './environment-v3.mjs';
import { everydayPhV3Dialogues } from './everyday-ph-v3.mjs';
import { additionalV3Dialogues } from './additional-v3.mjs';
import { gapFillingV3Dialogues } from './gap-filling-v3.mjs';
import { comprehensiveV3Dialogues } from './comprehensive-v3.mjs';
import { physicsV3Dialogues } from './comprehensive-physics-v3.mjs';
import { chemistryV3Dialogues } from './comprehensive-chemistry-v3.mjs';
import { earthScienceExpandedDialogues as earthScienceMoreDialogues } from './earth-science-more.mjs';
import { grade34V2Dialogues } from './grade3-4-v2.mjs';
import { grade56V2Dialogues } from './grade5-6-v2.mjs';
import { philippineScienceV2Dialogues } from './philippine-science-v2.mjs';
import { practicalScienceV2Dialogues } from './practical-science-v2.mjs';

// Combine all dialogues
const allDialogues = [
  ...matterDialogues,
  ...livingThingsDialogues,
  ...forceMotionEnergyDialogues,
  ...earthSpaceDialogues,
  ...environmentDialogues,
  ...authenticTeachingDialogues,
  ...scienceFundamentalsDialogues,
  ...biologyExpandedDialogues,
  ...chemistryExpandedDialogues,
  ...physicsExpandedDialogues,
  ...earthScienceExpandedDialogues,
  ...environmentExpandedDialogues,
  ...matterExpandedDialogues,
  ...grade34Dialogues,
  ...grade56Dialogues,
  ...grade78Dialogues,
  ...grade910Dialogues,
  ...practicalApplicationsDialogues,
  // v2 expansion
  ...matterV2Dialogues,
  ...biologyV2Dialogues,
  ...earthWeatherV2Dialogues,
  ...physicsV2Dialogues,
  ...chemistryV2Dialogues,
  ...everydayPhV2Dialogues,
  ...grade34V2Dialogues,
  ...grade56V2Dialogues,
  ...philippineScienceV2Dialogues,
  ...practicalScienceV2Dialogues,
  // v3: RH redirects + high-quality targeted dialogues
  ...rhRedirectDialogues,
  ...qualityV3Dialogues,
  ...biologyV3Dialogues,
  ...environmentV3Dialogues,
  ...everydayPhV3Dialogues,
  ...additionalV3Dialogues,
  ...gapFillingV3Dialogues,
  ...comprehensiveV3Dialogues,
  ...physicsV3Dialogues,
  ...chemistryV3Dialogues,
  ...earthScienceMoreDialogues,
];

console.log(`📚 Generating Tagalog science dataset...\n`);
console.log(`Total dialogues: ${allDialogues.length}`);

// RH guardrail appended to every system prompt at generation time
const RH_GUARDRAIL = ' Kung tatanungin ka tungkol sa reproductive health, sexual health, o puberty, magalang na tumanggi at i-refer ang estudyante sa kanilang magulang, doktor, o guro sa Health — huwag sumagot sa paksang iyon.';

// Convert to HuggingFace chat format and write as JSONL
const jsonlLines = allDialogues.map(dialogue => {
  const systemWithGuardrail = dialogue.system.trimEnd() + RH_GUARDRAIL;
  return JSON.stringify({
    messages: [
      { role: 'system', content: systemWithGuardrail },
      { role: 'user', content: dialogue.user },
      { role: 'assistant', content: dialogue.assistant }
    ]
  });
});

const outputFile = 'science-chat-v2.jsonl';
writeFileSync(outputFile, jsonlLines.join('\n') + '\n');

console.log(`✅ Generated: ${outputFile}`);

// Statistics
const stats = {
  total: allDialogues.length,
  domains: {
    matter: matterDialogues.length,
    livingThings: livingThingsDialogues.length,
    forceMotionEnergy: forceMotionEnergyDialogues.length,
    earthSpace: earthSpaceDialogues.length,
    environment: environmentDialogues.length,
    authenticTeaching: authenticTeachingDialogues.length,
    scienceFundamentals: scienceFundamentalsDialogues.length,
    biologyExpanded: biologyExpandedDialogues.length,
    chemistryExpanded: chemistryExpandedDialogues.length,
    physicsExpanded: physicsExpandedDialogues.length,
    earthScienceExpanded: earthScienceExpandedDialogues.length,
    environmentExpanded: environmentExpandedDialogues.length,
    matterExpanded: matterExpandedDialogues.length,
    grade34: grade34Dialogues.length,
    grade56: grade56Dialogues.length,
    grade78: grade78Dialogues.length,
    grade910: grade910Dialogues.length,
    practicalApplications: practicalApplicationsDialogues.length,
    matterV2: matterV2Dialogues.length,
    biologyV2: biologyV2Dialogues.length,
    earthWeatherV2: earthWeatherV2Dialogues.length,
    physicsV2: physicsV2Dialogues.length,
    chemistryV2: chemistryV2Dialogues.length,
    everydayPhV2: everydayPhV2Dialogues.length,
    rhRedirects: rhRedirectDialogues.length,
    qualityV3: qualityV3Dialogues.length,
    biologyV3: biologyV3Dialogues.length,
    environmentV3: environmentV3Dialogues.length,
    everydayPhV3: everydayPhV3Dialogues.length,
    additionalV3: additionalV3Dialogues.length,
    gapFillingV3: gapFillingV3Dialogues.length,
    comprehensiveV3: comprehensiveV3Dialogues.length,
    physicsV3: physicsV3Dialogues.length,
    chemistryV3: chemistryV3Dialogues.length,
  }
};

console.log(`\n📊 Statistics:`);
console.log(`  Matter: ${stats.domains.matter}`);
console.log(`  Living Things: ${stats.domains.livingThings}`);
console.log(`  Force/Motion/Energy: ${stats.domains.forceMotionEnergy}`);
console.log(`  Earth/Space: ${stats.domains.earthSpace}`);
console.log(`  Environment: ${stats.domains.environment}`);
console.log(`  Authentic Teaching: ${stats.domains.authenticTeaching}`);
console.log(`  Science Fundamentals: ${stats.domains.scienceFundamentals}`);
console.log(`  Biology Expanded: ${stats.domains.biologyExpanded}`);
console.log(`  Chemistry Expanded: ${stats.domains.chemistryExpanded}`);
console.log(`  Physics Expanded: ${stats.domains.physicsExpanded}`);
console.log(`  Earth Science Expanded: ${stats.domains.earthScienceExpanded}`);
console.log(`  Environment Expanded: ${stats.domains.environmentExpanded}`);
console.log(`  Matter Expanded: ${stats.domains.matterExpanded}`);
console.log(`  Grade 3-4: ${stats.domains.grade34}`);
console.log(`  Grade 5-6: ${stats.domains.grade56}`);
console.log(`  Grade 7-8: ${stats.domains.grade78}`);
console.log(`  Grade 9-10: ${stats.domains.grade910}`);
console.log(`  Practical Applications: ${stats.domains.practicalApplications}`);
console.log(`  ─────────────────────`);
console.log(`  Total: ${stats.total} dialogues`);

// Estimate token count (rough estimate: ~0.75 tokens per word)
const totalChars = allDialogues.reduce((sum, d) => {
  return sum + d.system.length + d.user.length + d.assistant.length;
}, 0);
const totalWords = totalChars / 5; // rough estimate
const estimatedTokens = Math.round(totalWords * 0.75);

console.log(`\n📝 Size estimates:`);
console.log(`  Total characters: ${totalChars.toLocaleString()}`);
console.log(`  Estimated tokens: ~${estimatedTokens.toLocaleString()}`);
console.log(`  Average tokens per dialogue: ~${Math.round(estimatedTokens / stats.total)}`);

// Check for max length
const maxLength = allDialogues.reduce((max, d) => {
  const len = d.system.length + d.user.length + d.assistant.length;
  return len > max.len ? { len, dialogue: d } : max;
}, { len: 0, dialogue: null });

console.log(`\n📏 Length analysis:`);
console.log(`  Longest dialogue: ${maxLength.len.toLocaleString()} characters`);
console.log(`  Average dialogue: ${Math.round(totalChars / stats.total).toLocaleString()} characters`);

console.log(`\n✨ Dataset ready for training!`);

#!/usr/bin/env node
/**
 * Generator script for Bisaya/Cebuano science training dataset
 * Combines all domain dialogues into a single JSONL file
 */

import { writeFileSync } from 'fs';
import { scienceFundamentalsDialogues } from './science-fundamentals.mjs';
import { matterDialogues } from './matter.mjs';
import { matterExpandedDialogues } from './matter-expanded.mjs';
import { livingThingsDialogues } from './living-things.mjs';
import { livingThingsExpandedDialogues } from './living-things-expanded.mjs';
import { forceMotionEnergyDialogues } from './force-motion-energy.mjs';
import { forceMotionEnergyExpandedDialogues } from './force-motion-energy-expanded.mjs';
import { earthSpaceDialogues } from './earth-space.mjs';
import { earthSpaceExpandedDialogues } from './earth-space-expanded.mjs';
import { environmentDialogues } from './environment.mjs';
import { environmentExpandedDialogues } from './environment-expanded.mjs';
import { grade34Dialogues } from './grade3-4-dialogues.mjs';
import { grade56Dialogues } from './grade5-6-dialogues.mjs';
import { grade78Dialogues } from './grade7-8-dialogues.mjs';
import { grade910Dialogues } from './grade9-10-dialogues.mjs';
import { practicalApplicationsDialogues } from './practical-applications.mjs';
import { chemistryDialogues } from './chemistry-dialogues.mjs';
import { biologyDialogues } from './biology-dialogues.mjs';
import { physicsProblemsDialogues } from './physics-problems.mjs';
import { healthDialogues } from './health-dialogues.mjs';
import { earthScienceDialogues } from './earth-science-dialogues.mjs';
import { authenticStoriesDialogues } from './authentic-stories.mjs';
import { grade36ScienceDialogues } from './grade3-6-science.mjs';
import { bloomGroundedV1Dialogues } from './bloom-grounded-v1.mjs';
import { bloomGroundedV2Dialogues } from './bloom-grounded-v2.mjs';
import { bloomGroundedV3Dialogues } from './bloom-grounded-v3.mjs';
import { workflowPilotDialogues } from './workflow-pilot.mjs';
import { workflowWave2Dialogues } from './workflow-wave2.mjs';
import { workflowFinalDialogues } from './workflow-final.mjs';
import { workflowMakeupDialogues } from './workflow-makeup.mjs';

// Combine all dialogues
const allDialogues = [
  ...scienceFundamentalsDialogues,
  ...matterDialogues,
  ...matterExpandedDialogues,
  ...livingThingsDialogues,
  ...livingThingsExpandedDialogues,
  ...forceMotionEnergyDialogues,
  ...forceMotionEnergyExpandedDialogues,
  ...earthSpaceDialogues,
  ...earthSpaceExpandedDialogues,
  ...environmentDialogues,
  ...environmentExpandedDialogues,
  ...grade34Dialogues,
  ...grade56Dialogues,
  ...grade78Dialogues,
  ...grade910Dialogues,
  ...practicalApplicationsDialogues,
  ...chemistryDialogues,
  ...biologyDialogues,
  ...physicsProblemsDialogues,
  ...healthDialogues,
  ...earthScienceDialogues,
  ...authenticStoriesDialogues,
  ...grade36ScienceDialogues,
  ...bloomGroundedV1Dialogues,
  ...bloomGroundedV2Dialogues,
  ...bloomGroundedV3Dialogues,
  ...workflowPilotDialogues,
  ...workflowWave2Dialogues,
  ...workflowFinalDialogues,
  ...workflowMakeupDialogues,
];

console.log(`📚 Generating Bisaya science dataset...\n`);
console.log(`Total dialogues: ${allDialogues.length}`);

// Convert to HuggingFace chat format and write as JSONL
const jsonlLines = allDialogues.map(dialogue => {
  return JSON.stringify({
    messages: [
      { role: 'system', content: dialogue.system },
      { role: 'user', content: dialogue.user },
      { role: 'assistant', content: dialogue.assistant }
    ]
  });
});

const outputFile = 'science-chat.jsonl';
writeFileSync(outputFile, jsonlLines.join('\n') + '\n');

console.log(`✅ Generated: ${outputFile}`);

// Statistics
const stats = {
  total: allDialogues.length,
  domains: {
    scienceFundamentals: scienceFundamentalsDialogues.length,
    matter: matterDialogues.length,
    matterExpanded: matterExpandedDialogues.length,
    livingThings: livingThingsDialogues.length,
    livingThingsExpanded: livingThingsExpandedDialogues.length,
    forceMotionEnergy: forceMotionEnergyDialogues.length,
    forceMotionEnergyExpanded: forceMotionEnergyExpandedDialogues.length,
    earthSpace: earthSpaceDialogues.length,
    earthSpaceExpanded: earthSpaceExpandedDialogues.length,
    environment: environmentDialogues.length,
    environmentExpanded: environmentExpandedDialogues.length,
    grade34: grade34Dialogues.length,
    grade56: grade56Dialogues.length,
    grade78: grade78Dialogues.length,
    grade910: grade910Dialogues.length,
    practicalApplications: practicalApplicationsDialogues.length,
    authenticStories: authenticStoriesDialogues.length,
    grade36Science: grade36ScienceDialogues.length,
  }
};

console.log(`\n📊 Statistics:`);
console.log(`  Science Fundamentals: ${stats.domains.scienceFundamentals}`);
console.log(`  Matter (original): ${stats.domains.matter}`);
console.log(`  Matter (expanded): ${stats.domains.matterExpanded}`);
console.log(`  Living Things (original): ${stats.domains.livingThings}`);
console.log(`  Living Things (expanded): ${stats.domains.livingThingsExpanded}`);
console.log(`  Force/Motion/Energy (original): ${stats.domains.forceMotionEnergy}`);
console.log(`  Force/Motion/Energy (expanded): ${stats.domains.forceMotionEnergyExpanded}`);
console.log(`  Earth/Space (original): ${stats.domains.earthSpace}`);
console.log(`  Earth/Space (expanded): ${stats.domains.earthSpaceExpanded}`);
console.log(`  Environment (original): ${stats.domains.environment}`);
console.log(`  Environment (expanded): ${stats.domains.environmentExpanded}`);
console.log(`  Grade 3-4: ${stats.domains.grade34}`);
console.log(`  Grade 5-6: ${stats.domains.grade56}`);
console.log(`  Grade 7-8: ${stats.domains.grade78}`);
  console.log(`  Grade 9-10: ${stats.domains.grade910}`);
  console.log(`  Practical Applications: ${stats.domains.practicalApplications}`);
  console.log(`  Authentic Stories: ${stats.domains.authenticStories}`);
  console.log(`  Grade 3-6 Science: ${stats.domains.grade36Science}`);
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

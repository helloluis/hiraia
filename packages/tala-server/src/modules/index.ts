/**
 * Module registry. OWNER: orchestrator. Workers never edit this file: every module is already listed,
 * and each worker replaces the stub in its own folder.
 */
import type { ServerModule } from '../kernel/types';
import { communityModule } from './community';
import { coreModule } from './core';
import { curriculumModule } from './curriculum';
import { generationModule } from './generation';
import { llmModule } from './llm';
import { printModule } from './print';
import { packsModule } from './packs';
import { decksModule } from './decks';
import { rosterModule } from './roster';

/** Order matters for migrations and service wiring: core first. */
export const modules: ServerModule[] = [
  coreModule,
  curriculumModule,
  llmModule,
  generationModule,
  rosterModule,
  communityModule,
  printModule,
  packsModule,
  decksModule,
];

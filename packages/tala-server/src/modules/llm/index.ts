/**
 * Module: llm — model gateway (DeepSeek -> Qwen -> local), quotas, budget, prompt registry; provides services.llm
 * OWNER: workstream C. Replace this stub; keep the export name. Everything under this folder is yours.
 */
import type { ServerModule } from '../../kernel/types';

export const llmModule: ServerModule = {
  name: 'llm',
  migrations: [],
  handlers: {},
};

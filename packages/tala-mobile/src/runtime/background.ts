import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
const TASK = 'tala-opportunistic-sync';
// Android schedules opportunistically; foreground/network triggers remain the reliable path.
let sync: (() => Promise<boolean>) | null = null;
TaskManager.defineTask(TASK, async () => {
  try {
    // Cold background launches initialise the same durable store/session, without mounting UI.
    if (!sync) { const { createRuntime } = await import('./runtime'); const runtime = await createRuntime(); return (await runtime.engine.sync()).ok ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed; }
    return await sync() ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
  } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
export async function registerBackground(run: () => Promise<boolean>) {
  sync = run;
  if (await BackgroundTask.getStatusAsync() === BackgroundTask.BackgroundTaskStatus.Available) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
}

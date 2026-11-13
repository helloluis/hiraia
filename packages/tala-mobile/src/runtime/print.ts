import { renderPlanHtml, renderPlanText, printPageSize } from '@hiraia/tala-core/print';
import type { RenderPlanOptions } from '@hiraia/tala-core/print';
export type PrintInput = RenderPlanOptions;
export { renderPlanHtml as renderHtml, renderPlanText, printPageSize };
export async function exportWithFallback(
  input: PrintInput,
  io: {
    print(html: string): Promise<void>;
    text(text: string): Promise<void>;
    server?(): Promise<void>;
  },
  cancelled: () => boolean = () => false
) {
  for (const includeImages of [input.includeImages ?? true, false]) {
    if (cancelled()) return 'cancelled';
    try {
      await io.print(renderPlanHtml({ ...input, includeImages }));
      return includeImages ? 'pdf' : 'pdf-no-images';
    } catch {
      /* next lighter path */
    }
  }
  if (cancelled()) return 'cancelled';
  try {
    await io.text(renderPlanText(input));
    return 'text';
  } catch {
    if (!cancelled() && io.server) {
      await io.server();
      return 'server';
    }
    throw new Error('Export unavailable');
  }
}

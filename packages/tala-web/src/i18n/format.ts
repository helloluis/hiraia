export type Vars = Record<string, string | number>;
/** `{name}` interpolation. Kept dependency-free so Node tests and server components can use it. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

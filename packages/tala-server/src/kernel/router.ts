/**
 * Router built from the `API` table in @hiraia/tala-core. No route exists that is not in that table.
 * OWNER: workstream A.
 */
import { API, API_BASE, ROUTE_NAMES } from '@hiraia/tala-core';
import type { RouteName, RouteSpec } from '@hiraia/tala-core';

type Segment = { literal: string } | { param: string };

export interface CompiledRoute {
  name: RouteName;
  spec: RouteSpec;
  segments: Segment[];
  literalCount: number;
}

export type RouteMatch =
  | { kind: 'match'; route: CompiledRoute; params: Record<string, string> }
  | { kind: 'method_not_allowed'; allow: string[] }
  | { kind: 'bad_path' }
  | { kind: 'not_found' };

const MAX_PARAM_LENGTH = 200;

/**
 * `extra` adds routes that are not in the contract table yet. It exists so handlers written ahead of a
 * contract change can be tested through the whole request path; production never passes it. A name that
 * is already in the table is ignored here: the contract's own spec wins.
 */
export function compileRoutes(extra: Record<string, RouteSpec> = {}): CompiledRoute[] {
  const specs: Array<[string, RouteSpec]> = [...ROUTE_NAMES.map((name): [string, RouteSpec] => [name, API[name]]), ...Object.entries(extra).filter(([name]) => !(name in API))];
  const routes = specs.map(([routeName, spec]): CompiledRoute => {
    const name = routeName as RouteName;
    const segments = spec.path
      .split('/')
      .filter(Boolean)
      .map((s): Segment => (s.startsWith(':') ? { param: s.slice(1) } : { literal: s }));
    return { name, spec, segments, literalCount: segments.filter((s) => 'literal' in s).length };
  });
  // More literal segments first, so a fixed path always beats a parameter in the same position.
  return routes.sort((a, b) => b.literalCount - a.literalCount);
}

/** Path under API_BASE as segments, or null when the path is not under it. */
export function splitApiPath(pathname: string): string[] | null {
  if (pathname !== API_BASE && !pathname.startsWith(`${API_BASE}/`)) return null;
  return pathname
    .slice(API_BASE.length)
    .split('/')
    .filter((s, i, all) => s !== '' || (i !== 0 && i !== all.length - 1));
}

function matchSegments(route: CompiledRoute, parts: string[]): Record<string, string> | 'bad' | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const segment = route.segments[i]!;
    const part = parts[i]!;
    if ('literal' in segment) {
      if (segment.literal !== part) return null;
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      return 'bad';
    }
    // eslint-disable-next-line no-control-regex
    if (value.length === 0 || value.length > MAX_PARAM_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return 'bad';
    params[segment.param] = value;
  }
  return params;
}

export function matchRoute(routes: CompiledRoute[], method: string, pathname: string): RouteMatch {
  const parts = splitApiPath(pathname);
  if (parts === null || parts.some((p) => p === '')) return { kind: 'not_found' };
  const allow = new Set<string>();
  let bad = false;
  for (const route of routes) {
    const params = matchSegments(route, parts);
    if (params === null) continue;
    if (params === 'bad') {
      bad = true;
      continue;
    }
    if (route.spec.method === method) return { kind: 'match', route, params };
    allow.add(route.spec.method);
  }
  if (allow.size > 0) return { kind: 'method_not_allowed', allow: [...allow].sort() };
  return bad ? { kind: 'bad_path' } : { kind: 'not_found' };
}

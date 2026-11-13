/**
 * Google Identity Services (ID-token flow, PRD §13.3 AUTH-9). The script is loaded only when the server says the
 * feature is on, and only when a Google button is actually shown. The client id is a public value
 * (`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`); no secret is ever in the browser.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? '';

interface GsiButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill';
  width?: number;
  locale?: string;
}
interface GsiId {
  initialize(config: {
    client_id: string;
    callback: (r: { credential: string }) => void;
    ux_mode?: 'popup';
    auto_select?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(el: HTMLElement, opts: GsiButtonOptions): void;
  prompt(): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GsiId } };
  }
}

const SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<GsiId> | null = null;

export function loadGoogleIdentity(): Promise<GsiId> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.defer = true;
      s.onload = () =>
        window.google?.accounts?.id
          ? resolve(window.google.accounts.id)
          : reject(new Error('gsi missing'));
      s.onerror = () => {
        loading = null;
        reject(new Error('gsi failed'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Render the official button into `el`; resolves credentials through `onCredential`. */
export async function renderGoogleButton(
  el: HTMLElement,
  onCredential: (idToken: string) => void,
  opts: { locale: string; text?: GsiButtonOptions['text'] }
): Promise<void> {
  if (!GOOGLE_CLIENT_ID) throw new Error('no client id');
  const id = await loadGoogleIdentity();
  id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r) => onCredential(r.credential),
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,
  });
  el.innerHTML = '';
  id.renderButton(el, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: opts.text ?? 'continue_with',
    shape: 'rectangular',
    width: Math.min(400, Math.max(200, el.clientWidth || 320)),
    locale: opts.locale,
  });
}

/** Email claim of an ID token, for display only (the server verifies the token). */
export function idTokenEmail(idToken: string): string {
  try {
    const payload = idToken.split('.')[1] ?? '';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.email === 'string' ? json.email : '';
  } catch {
    return '';
  }
}

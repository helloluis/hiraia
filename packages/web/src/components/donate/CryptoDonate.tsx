'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CryptoDonate.module.css';
import {
  DEFAULT_CHAIN,
  DONATION_ADDRESS,
  DONATION_CHAINS,
  THIRDWEB_CLIENT_ID,
  TOKEN_CONTRACTS,
  TOKEN_ORDER,
  chainFor,
  defaultAmount,
  tokenFor,
  validAmount,
  validEmail,
  type DonationChain,
  type DonationToken,
} from './config';

type DonationResult = { chainId: number; hashes: string[] };
type WidgetModule = {
  mount: (
    element: HTMLElement,
    options: {
      clientId: string;
      seller: string;
      chainId: number;
      chainName: string;
      tokenAddress: string | null;
      tokenSymbol: string;
      amount: string;
      purchaseRef: string | null;
      onSuccess: (result: DonationResult) => void;
      onError: (message: string) => void;
    },
  ) => () => void;
};

// The checkout is built outside Next (scripts/build-donate-widget.mjs) and fetched on demand.
let widgetModule: Promise<WidgetModule> | null = null;
function loadWidget(): Promise<WidgetModule> {
  widgetModule ??= fetch('/donate-widget/manifest.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json() as Promise<{ entry: string }>;
    })
    .then(({ entry }) => import(/* webpackIgnore: true */ entry) as Promise<WidgetModule>)
    .catch((e) => {
      widgetModule = null;
      throw e;
    });
  return widgetModule;
}

function Checkout({
  clientId,
  chain,
  token,
  amount,
  purchaseRef,
  onSuccess,
  onError,
}: {
  clientId: string;
  chain: DonationChain;
  token: DonationToken;
  amount: string;
  purchaseRef: string | null;
  onSuccess: (r: DonationResult) => void;
  onError: (m: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const callbacks = useRef({ onSuccess, onError });
  callbacks.current = { onSuccess, onError };

  useEffect(() => {
    let unmount: (() => void) | null = null;
    let cancelled = false;
    setState('loading');
    loadWidget()
      .then((m) => {
        if (cancelled || !host.current) return;
        unmount = m.mount(host.current, {
          clientId,
          seller: DONATION_ADDRESS,
          chainId: chain.id,
          chainName: chain.name,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          amount,
          purchaseRef,
          onSuccess: (r) => callbacks.current.onSuccess(r),
          onError: (msg) => callbacks.current.onError(msg),
        });
        setState('ready');
      })
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
      // Defer so React finishes this commit before the widget's own root unmounts.
      const u = unmount;
      if (u) window.setTimeout(u, 0);
    };
  }, [clientId, chain.id, chain.name, token.address, token.symbol, amount, purchaseRef]);

  return (
    <div className={styles.widget}>
      {state === 'loading' && <p className={styles.loading}>Opening the secure checkout…</p>}
      {state === 'failed' && (
        <p className={styles.problem} role="status">
          The checkout couldn&apos;t load. Please try again, or send to the address shown here.
        </p>
      )}
      <div ref={host} data-testid="donate-widget-host" />
    </div>
  );
}

export function CryptoDonate() {
  const [chainKey, setChainKey] = useState(DEFAULT_CHAIN.key);
  const chain = DONATION_CHAINS.find((c) => c.key === chainKey) ?? DEFAULT_CHAIN;
  const [symbol, setSymbol] = useState<DonationToken['symbol']>('USDT');
  const token = tokenFor(chain, symbol);
  const [amount, setAmount] = useState(() => defaultAmount(tokenFor(DEFAULT_CHAIN, 'USDT')));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<DonationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Optional donor email: blank = anonymous and nothing is sent anywhere. When filled, it is stored
  // privately on hiraia.org and the checkout carries only a random reference to it.
  const [email, setEmail] = useState('');
  const [purchaseRef, setPurchaseRef] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const trimmedEmail = email.trim();
  const emailProblem = trimmedEmail && !validEmail(trimmedEmail) ? 'Please check the email, or leave it blank.' : null;
  const problem = validAmount(amount, token);
  const configured = THIRDWEB_CLIENT_ID !== null;
  // The thirdweb client ID is locked to https://hiraia.org; www.hiraia.org serves the same page
  // but its requests are refused, so there the button sends donors to the apex instead.
  const [apexUrl, setApexUrl] = useState<string | null>(null);
  useEffect(() => {
    const { hostname, pathname } = window.location;
    if (hostname.startsWith('www.')) setApexUrl(`https://${hostname.slice(4)}${pathname}#donate-title`);
  }, []);

  // USDT exists only where Tether issues it (Ethereum): picking it moves the network there.
  const pickToken = (next: DonationToken['symbol']) => {
    const target = chain.tokens.some((t) => t.symbol === next) ? chain : chainFor(next);
    setChainKey(target.key);
    setSymbol(next);
    setAmount(defaultAmount(tokenFor(target, next)));
    reset();
  };
  const pickChain = (next: DonationChain) => {
    setChainKey(next.key);
    if (!next.tokens.some((t) => t.symbol === symbol)) {
      const fallback = tokenFor(next, symbol);
      setSymbol(fallback.symbol);
      setAmount(defaultAmount(fallback));
    }
    reset();
  };
  const reset = () => {
    setOpen(false);
    setDone(null);
    setError(null);
    setPurchaseRef(null);
    setSessionError(null);
  };

  const start = async () => {
    if (apexUrl) return window.location.assign(apexUrl);
    if (!trimmedEmail) {
      setPurchaseRef(null);
      setOpen(true);
      return;
    }
    setStarting(true);
    setSessionError(null);
    try {
      const res = await fetch('/api/donations/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, chainId: chain.id, token: token.symbol, amount: amount.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ref?: string; error?: string };
      if (!res.ok || !body.ref) throw new Error(body.error || 'We could not save your email right now.');
      setPurchaseRef(body.ref);
      setOpen(true);
    } catch (e) {
      setSessionError(
        `${e instanceof Error ? e.message : 'We could not save your email right now.'} Try again, or clear the email to donate anonymously.`,
      );
    } finally {
      setStarting(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DONATION_ADDRESS);
    } catch {
      const range = document.createRange();
      const node = document.getElementById('donation-address');
      if (node) {
        range.selectNodeContents(node);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section className={styles.donate} aria-labelledby="donate-title">
      <div className={styles.card}>
        <p className={`mc-label ${styles.eyebrow}`}>Donate with crypto</p>
        <h2 id="donate-title">Fund the work directly</h2>
        <p className={styles.lead}>
          Connect an Ethereum wallet, choose a network, a token and an amount. Your donation goes
          straight to Hiraia&apos;s address on the network you pick, in the token you send.
        </p>

        <fieldset className={styles.group}>
          <legend>Network</legend>
          <div className={styles.chips}>
            {DONATION_CHAINS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={styles.chip}
                aria-pressed={c.key === chain.key}
                onClick={() => pickChain(c)}
              >
                <b>{c.name}</b>
                <span>{c.note}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Token</legend>
          <div className={styles.chips}>
            {TOKEN_ORDER.map((sym) => {
              const here = chain.tokens.some((t) => t.symbol === sym);
              const label =
                sym === 'USDT'
                  ? here
                    ? 'Tether · ERC-20'
                    : 'Tether · on Ethereum'
                  : sym === 'USDC'
                    ? 'US dollar stablecoin'
                    : `Ether on ${chain.name}`;
              return (
                <button
                  key={sym}
                  type="button"
                  className={styles.chip}
                  aria-pressed={here && sym === token.symbol}
                  onClick={() => pickToken(sym)}
                  data-token={sym}
                >
                  <b>{sym}</b>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Amount ({token.symbol})</legend>
          <div className={styles.amounts}>
            {token.presets.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.preset}
                aria-pressed={amount === p}
                onClick={() => {
                  setAmount(p);
                  reset();
                }}
              >
                {token.symbol === 'ETH' ? p : `$${p}`}
              </button>
            ))}
            <label className={styles.custom}>
              <span className="sr-only">Other amount in {token.symbol}</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 24));
                  reset();
                }}
                aria-invalid={problem !== null}
                aria-describedby="donate-amount-note"
              />
              <span aria-hidden="true">{token.symbol}</span>
            </label>
          </div>
          <p id="donate-amount-note" className={problem ? styles.problem : styles.hint}>
            {problem ?? 'thirdweb, the checkout provider, adds a 0.3% fee to the payment.'}
          </p>
        </fieldset>

        <div className={styles.group}>
          <label htmlFor="donor-email" className={styles.emailLabel}>
            Email <span>(optional — so we can thank you)</span>
          </label>
          <input
            id="donor-email"
            className={styles.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="Leave blank to give anonymously"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              reset();
            }}
            aria-invalid={emailProblem !== null}
            aria-describedby="donor-email-note"
          />
          <p id="donor-email-note" className={emailProblem ? styles.problem : styles.hint}>
            {emailProblem ??
              'Used only to say thank you. Never published or shared, never sent to the checkout provider or the blockchain, and deleted within six months.'}
          </p>
        </div>

        {done ? (
          <div className={styles.thanks} role="status">
            <p>
              <b>Thank you!</b> Your donation of {amount} {token.symbol} on {chain.name} was sent.
              {purchaseRef ? ` We'll write to ${trimmedEmail} to say thanks.` : ''}
            </p>
            {done.hashes.map((h) => (
              <a key={h} href={`${chain.explorer}/tx/${h}`} target="_blank" rel="noopener">
                View the transaction ↗
              </a>
            ))}
          </div>
        ) : !configured ? (
          <div className={styles.pending} role="note">
            <p>
              <b>Wallet checkout is being set up.</b> Until it opens, you can send {token.symbol} on{' '}
              {chain.name} to Hiraia&apos;s address. Thank you!
            </p>
          </div>
        ) : open && !problem ? (
          <>
            <Checkout
              clientId={THIRDWEB_CLIENT_ID!}
              chain={chain}
              token={token}
              amount={amount}
              purchaseRef={purchaseRef}
              onSuccess={(r) => setDone(r)}
              onError={(m) => setError(m)}
            />
            {error && (
              <p className={styles.problem} role="status">
                {error}
              </p>
            )}
            <p className={styles.hint}>
              Trouble with the checkout? You can always send to Hiraia&apos;s address instead.
            </p>
          </>
        ) : (
          <>
            <div className="mc-ledge">
              <button
                type="button"
                className="mc-ticket"
                disabled={problem !== null || emailProblem !== null || starting}
                aria-busy={starting}
                onClick={() => void start()}
              >
                <span className="flex-1">
                  Donate {problem ? '' : `${amount} `}
                  {token.symbol} on {chain.name}
                </span>
                <span className="mc-arrow" aria-hidden />
              </button>
            </div>
            {sessionError && (
              <p className={styles.problem} role="status">
                {sessionError}
              </p>
            )}
          </>
        )}
      </div>

      <aside className={styles.direct} aria-labelledby="direct-title">
        <p className={`mc-label ${styles.eyebrow}`}>Or send directly</p>
        <h3 id="direct-title">Hiraia&apos;s address</h3>
        <p>
          Send USDT, USDC or ETH from any wallet or exchange. Direct transfers carry no fee from
          Hiraia or thirdweb: only your network&apos;s gas, plus any withdrawal fee your
          exchange charges.
        </p>
        <code id="donation-address" className={styles.address}>
          {DONATION_ADDRESS}
        </code>
        <button type="button" className={styles.copy} onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy address'}
        </button>
        <ul className={styles.rules}>
          <li>
            <b>Networks:</b> {DONATION_CHAINS.map((c) => c.name).join(', ')}.
          </li>
          <li>
            <b>USDT:</b> on Ethereum only, the network where Tether issues it. Withdrawing from an
            exchange? Choose <b>Ethereum (ERC-20)</b>, not TRC-20 (Tron) or BEP-20.
          </li>
          <li>
            <b>USDC or ETH:</b> on any of the three networks.
          </li>
          <li>
            Ethereum-family networks only: this address cannot receive Bitcoin or Solana. To give
            on another network, please email <a href="mailto:lb@hiraia.org">lb@hiraia.org</a> first.
          </li>
        </ul>
        <details className={styles.contracts}>
          <summary>Token contracts we accept</summary>
          <ul>
            {TOKEN_CONTRACTS.map(({ chain: c, token: t, url }) => (
              <li key={`${c.id}:${t.symbol}`} data-chain={c.id} data-token={t.symbol}>
                <b>
                  {t.symbol} on {c.name}
                </b>
                <a href={url} target="_blank" rel="noopener">
                  <code>{t.address}</code>
                </a>
              </li>
            ))}
          </ul>
          <p>Checked against Tether&apos;s and Circle&apos;s official contract lists.</p>
        </details>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Address copied' : ''}
        </span>
      </aside>
    </section>
  );
}

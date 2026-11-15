/*
 * Crypto donations on /support. No thirdweb import here: this module is in the page's initial
 * bundle, and the SDK only loads when a donor opens the checkout (DonateWidget.tsx).
 *
 * Receiving address: Luis's EVM account (an EOA with no contract code on any of the chains
 * below, checked 2026-11-15), so the same key controls it on every chain listed. Funds arrive
 * as sent: the checkout only accepts the chosen token on the chosen chain, so nothing is
 * bridged or swapped on the way in.
 */
export const DONATION_ADDRESS = '0xE083DEc32098F00F0972a8B258ce4414dcF1ca2d';

/**
 * thirdweb client ID from the thirdweb dashboard (Project → Settings → Client ID). Public by
 * design: it is embedded in the browser bundle and locked to hiraia.org in the dashboard.
 * Baked in at build time from packages/web/.env.production. Empty or the placeholder means
 * "not configured": the wallet checkout stays closed and the address fallback still works.
 */
const RAW_CLIENT_ID = (process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? '').trim();
export const THIRDWEB_CLIENT_ID = /^[0-9a-f]{32}$/i.test(RAW_CLIENT_ID) ? RAW_CLIENT_ID : null;

export type DonationToken = {
  symbol: 'ETH' | 'USDC';
  /** Contract address, or null for the chain's native ETH. */
  address: string | null;
  decimals: number;
  presets: string[];
  min: number;
};

export type DonationChain = {
  id: number;
  key: 'ethereum' | 'base' | 'arbitrum';
  name: string;
  note: string;
  explorer: string;
  tokens: DonationToken[];
};

const ETH: Omit<DonationToken, 'presets' | 'min'> = { symbol: 'ETH', address: null, decimals: 18 };
const ETH_AMOUNTS = { presets: ['0.005', '0.01', '0.025', '0.05'], min: 0.0005 };
const USDC_AMOUNTS = { presets: ['10', '25', '50', '100'], min: 1 };

// Native Circle USDC on each chain (verified on-chain: symbol USDC, name "USD Coin", 6 decimals).
// Kept short on purpose: Ethereum, plus the two largest ETH L2s, so donors never need to
// bridge to an obscure chain. Base is Coinbase's network; Arbitrum is the most used rollup.
export const DONATION_CHAINS: DonationChain[] = [
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    note: 'Lowest fees',
    explorer: 'https://basescan.org',
    tokens: [
      { ...ETH, ...ETH_AMOUNTS },
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, ...USDC_AMOUNTS },
    ],
  },
  {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    note: 'Mainnet',
    explorer: 'https://etherscan.io',
    tokens: [
      { ...ETH, ...ETH_AMOUNTS },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, ...USDC_AMOUNTS },
    ],
  },
  {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    note: 'Arbitrum One',
    explorer: 'https://arbiscan.io',
    tokens: [
      { ...ETH, ...ETH_AMOUNTS },
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, ...USDC_AMOUNTS },
    ],
  },
];

export const DEFAULT_CHAIN = DONATION_CHAINS[0] as DonationChain;

/** The suggested starting amount for a token (its second preset). */
export const defaultAmount = (token: DonationToken) => token.presets[1] ?? token.presets[0] ?? '';
export const tokenFor = (chain: DonationChain, symbol: DonationToken['symbol']) =>
  chain.tokens.find((t) => t.symbol === symbol) ?? (chain.tokens[0] as DonationToken);

/** A positive decimal with no more places than the token supports, at or above its minimum. */
export function validAmount(value: string, token: DonationToken): string | null {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return 'Enter an amount, like 25 or 0.01.';
  const places = (v.split('.')[1] ?? '').length;
  if (places > token.decimals) return `${token.symbol} allows at most ${token.decimals} decimal places.`;
  const n = Number(v);
  if (!(n >= token.min)) return `The smallest ${token.symbol} donation here is ${token.min}.`;
  if (n > 1_000_000) return 'For a gift that large, please email lb@hiraia.org first.';
  return null;
}

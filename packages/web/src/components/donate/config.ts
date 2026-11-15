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
  symbol: 'USDT' | 'USDC' | 'ETH';
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
const STABLE_AMOUNTS = { presets: ['10', '25', '50', '100'], min: 1 };

/** Token picker order: USDT first (Hiraia is a Tether-supported project), then USDC, then ETH. */
export const TOKEN_ORDER: DonationToken['symbol'][] = ['USDT', 'USDC', 'ETH'];

// Every contract below was checked on 2026-11-15 against the issuer's official list AND on-chain
// (symbol, name, 6 decimals):
//  - USDT: Tether's list (tether.to/en/supported-protocols) has Ethereum
//    0xdac17f958d2ee523a2206206994597c13d831ec7 and no Base, Arbitrum, Optimism or Polygon
//    issuance. Bridged versions (e.g. USDT0 on Arbitrum, bridged USDT on Base) are not
//    Tether-issued, so USDT is offered on Ethereum only. On-chain: "Tether USD", USDT, 6.
//  - USDC: Circle's list (developers.circle.com/stablecoins/usdc-contract-addresses) has the
//    native USDC addresses below for Ethereum, Base and Arbitrum. On-chain: "USD Coin", USDC, 6.
// Networks are kept short on purpose: Ethereum, plus the two largest ETH L2s, so donors never
// need to bridge to an obscure chain. Base is Coinbase's network; Arbitrum is the most used
// rollup. Ethereum leads because it is the only listed network where Tether issues USDT.
export const DONATION_CHAINS: DonationChain[] = [
  {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    note: 'USDT, USDC or ETH',
    explorer: 'https://etherscan.io',
    tokens: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, ...STABLE_AMOUNTS },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, ...STABLE_AMOUNTS },
      { ...ETH, ...ETH_AMOUNTS },
    ],
  },
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    note: 'Lowest fees · USDC or ETH',
    explorer: 'https://basescan.org',
    tokens: [
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, ...STABLE_AMOUNTS },
      { ...ETH, ...ETH_AMOUNTS },
    ],
  },
  {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    note: 'Arbitrum One · USDC or ETH',
    explorer: 'https://arbiscan.io',
    tokens: [
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, ...STABLE_AMOUNTS },
      { ...ETH, ...ETH_AMOUNTS },
    ],
  },
];

export const DEFAULT_CHAIN = DONATION_CHAINS[0] as DonationChain;

/** The suggested starting amount for a token (its second preset). */
export const defaultAmount = (token: DonationToken) => token.presets[1] ?? token.presets[0] ?? '';
export const tokenFor = (chain: DonationChain, symbol: DonationToken['symbol']) =>
  chain.tokens.find((t) => t.symbol === symbol) ?? (chain.tokens[0] as DonationToken);
/** The first listed network that offers a token (USDT → Ethereum). */
export const chainFor = (symbol: DonationToken['symbol']) =>
  DONATION_CHAINS.find((c) => c.tokens.some((t) => t.symbol === symbol)) ?? DEFAULT_CHAIN;
/** Contract list for the page, issuer-verified (see above). */
export const TOKEN_CONTRACTS = DONATION_CHAINS.flatMap((c) =>
  c.tokens.filter((t) => t.address).map((t) => ({ chain: c, token: t, url: `${c.explorer}/token/${t.address}` })),
);

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

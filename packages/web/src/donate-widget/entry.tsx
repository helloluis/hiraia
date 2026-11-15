/*
 * The /support crypto checkout, built OUTSIDE Next by scripts/build-donate-widget.mjs into
 * public/donate-widget/ and loaded only when a donor opens it. Kept out of the Next bundle on
 * purpose: thirdweb splits its wallet directory into ~1,100 lazy chunks, and in Next's single
 * webpack runtime that chunk map alone added ~16 kB (gzip) to every page of the site.
 *
 * The donor already chose chain, token and amount on the page. `supportedTokens` limits what
 * they can pay with to exactly that token on that chain and `paymentMethods: ['crypto']`
 * turns off card on-ramps, so funds land as sent: no bridge, no swap. thirdweb's 0.3% protocol
 * fee is paid by the donor (feePayer "user", the default).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createThirdwebClient, defineChain, NATIVE_TOKEN_ADDRESS } from 'thirdweb';
import { CheckoutWidget, ThirdwebProvider, lightTheme } from 'thirdweb/react';
import { createWallet, walletConnect } from 'thirdweb/wallets';
import type { Address } from 'thirdweb/utils';

export type MountOptions = {
  clientId: string;
  seller: string;
  chainId: number;
  chainName: string;
  /** Contract address, or null for the chain's native ETH. */
  tokenAddress: string | null;
  tokenSymbol: string;
  amount: string;
  /** Random session reference when the donor left an email (never the email itself). */
  purchaseRef?: string | null;
  onSuccess: (result: { chainId: number; hashes: string[] }) => void;
  onError: (message: string) => void;
};

const WALLETS = [
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('me.rainbow'),
  createWallet('io.rabby'),
  walletConnect(),
];

const theme = lightTheme({
  colors: {
    modalBg: '#FFFDF7',
    borderColor: '#C9BFA6',
    separatorLine: '#E4D9BF',
    primaryText: '#1C3B2E',
    secondaryText: '#4D4740',
    accentText: '#2F6360',
    accentButtonBg: '#1C3B2E',
    accentButtonText: '#F4EAD5',
    primaryButtonBg: '#1C3B2E',
    primaryButtonText: '#F4EAD5',
    secondaryButtonBg: '#F4EAD5',
    secondaryButtonText: '#1C3B2E',
    secondaryButtonHoverBg: '#EADFC6',
    tertiaryBg: '#F4EAD5',
    connectedButtonBg: '#F4EAD5',
    connectedButtonBgHover: '#EADFC6',
    success: '#2F6360',
    danger: '#7A2E22',
  },
  fontFamily: "'Zilla Slab', Georgia, serif",
});

const clients = new Map<string, ReturnType<typeof createThirdwebClient>>();

function Checkout(o: MountOptions) {
  let client = clients.get(o.clientId);
  if (!client) {
    client = createThirdwebClient({ clientId: o.clientId });
    clients.set(o.clientId, client);
  }
  const chain = defineChain(o.chainId);
  const tokenAddress = (o.tokenAddress ?? NATIVE_TOKEN_ADDRESS) as Address;
  return (
    <ThirdwebProvider>
      <CheckoutWidget
        client={client}
        theme={theme}
        chain={chain}
        tokenAddress={tokenAddress}
        amount={o.amount}
        seller={o.seller as Address}
        name="Donation to Hiraia"
        description={`${o.amount} ${o.tokenSymbol} on ${o.chainName}, sent straight to Hiraia's address.`}
        buttonLabel={`Donate ${o.amount} ${o.tokenSymbol}`}
        paymentMethods={['crypto']}
        supportedTokens={{ [o.chainId]: [{ address: tokenAddress, symbol: o.tokenSymbol, name: o.tokenSymbol }] }}
        purchaseData={o.purchaseRef ? { purpose: 'hiraia-donation', ref: o.purchaseRef } : { purpose: 'hiraia-donation' }}
        connectOptions={{
          wallets: WALLETS,
          chain,
          chains: [chain],
          showAllWallets: false,
          appMetadata: { name: 'Hiraia', url: 'https://hiraia.org', logoUrl: 'https://hiraia.org/hiraia-profile.png' },
        }}
        style={{ width: '100%', maxWidth: '100%' }}
        onSuccess={({ statuses }) =>
          o.onSuccess({
            chainId: o.chainId,
            hashes: statuses.flatMap((s) => ('transactions' in s ? s.transactions.map((t) => t.transactionHash) : [])),
          })
        }
        onError={(error) => o.onError(error.message || 'The payment did not go through.')}
      />
    </ThirdwebProvider>
  );
}

/** Render the checkout into `element`; returns an unmount function. */
export function mount(element: HTMLElement, options: MountOptions): () => void {
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <Checkout {...options} />
    </StrictMode>,
  );
  return () => root.unmount();
}

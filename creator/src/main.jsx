import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import App, { ConfigRequired, Login } from './App.jsx';
import './style.css';

const appId = import.meta.env.VITE_PRIVY_APP_ID;
const quaiCyprus1 = defineChain({
  id: 9,
  name: 'Quai Cyprus-1',
  network: 'quai-cyprus-1',
  nativeCurrency: { name: 'Quai', symbol: 'QUAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.quai.network/cyprus1'] } },
  blockExplorers: { default: { name: 'Quai Explorer', url: 'https://explorer.qu.ai' } },
});

function Root() {
  if (!appId) return <ConfigRequired message="VITE_PRIVY_APP_ID is missing. Set it in the local frontend environment to enable Privy login." />;
  return <PrivyProvider
    appId={appId}
    config={{
      loginMethods: ['wallet', 'twitter'],
      appearance: {
        theme: 'dark',
        accentColor: '#dfbd76',
        walletChainType: 'ethereum-only',
        walletList: ['detected_ethereum_wallets'],
      },
      defaultChain: quaiCyprus1,
      supportedChains: [quaiCyprus1],
    }}
  >
    <App />
  </PrivyProvider>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);

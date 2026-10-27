import { defineConfig, type Plugin } from 'vite';

// The page talks to itself, the Watch, and Arc's RPC. Viewing keys typed here can go nowhere else.
const WATCH = process.env.VITE_WATCH ?? 'https://stowaway-watch-production.up.railway.app';
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' ${WATCH} https://rpc.testnet.arc.io`,
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer"`),
});

export default defineConfig({
  plugins: [cspPlugin()],
  define: { __WATCH__: JSON.stringify(WATCH) },
  optimizeDeps: { exclude: ['chit-zcash'] },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});

// lightwalletd client: the tip height and a transaction's raw bytes and mined height.
import grpc from '@grpc/grpc-js';
import loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const chit = createRequire(import.meta.url)('../chit/chit_wasm.js');
const def = loader.loadSync(fileURLToPath(new URL('../proto/lwd.proto', import.meta.url)), { longs: Number });
const { CompactTxStreamer } = grpc.loadPackageDefinition(def).cash.z.wallet.sdk.rpc;

const call = (client, method, req) =>
  new Promise((ok, fail) =>
    client[method](req, { deadline: Date.now() + 20_000 }, (err, res) => (err ? fail(err) : ok(res))),
  );

export function lightwalletd(endpoint) {
  const [host, port = '443'] = endpoint.replace(/^https?:\/\//, '').split(':');
  const creds = port === '443' || endpoint.startsWith('https') ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new CompactTxStreamer(`${host}:${port}`, creds);
  return {
    endpoint,
    async tip() {
      return Number((await call(client, 'GetLatestBlock', {})).height);
    },
    async info() {
      return call(client, 'GetLightdInfo', {});
    },
    /** Raw tx hex and its mined height (0 while in the mempool). The bytes are re-hashed
     * and must produce the txid asked for, so a lying server cannot swap the transaction. */
    async tx(txid) {
      if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('txid must be 64 hex characters');
      const display = Buffer.from(txid, 'hex');
      let lastErr;
      for (const hash of [Buffer.from(display).reverse(), display]) {
        try {
          const r = await call(client, 'GetTransaction', { hash });
          const hex = Buffer.from(r.data).toString('hex');
          if (chit.txid(hex) !== txid) throw new Error('lightwalletd returned a different transaction');
          const h = Number(r.height);
          return { hex, height: h > 0 && h < 2 ** 63 ? h : 0 };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    },
  };
}

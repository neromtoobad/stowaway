import test from 'node:test';
import assert from 'node:assert/strict';
import { envelopeSecret, envelopePublic, seal, open } from '../src/envelope.js';
import { memoFor } from '../src/watch.js';

const keys = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32)];
const secrets = keys.map(envelopeSecret);
const pubs = secrets.map(envelopePublic);
const ua = 'u1h73y56yf5c5uxnxh75tfxta9fqtr9vtlnedpmuqtje8pv6hnrt2rj9jnnqrdpyvks7kvlzzyhx5xmkel0g0rtwy88jgtr4a8h6sutw2zznstdqsh56skszs95n07evxwxu6sv66agpj6yy6200xxgdgazeadwyuseyfwahx68j8nh7hga2qm9vxegxcmz2uw7s0lgyhv3uf0w6awxyq';

test('each Watch opens only its own slot', () => {
  const env = seal(ua, pubs);
  secrets.forEach((s, i) => assert.equal(open(env, i, s), ua));
  assert.equal(open(env, 0, secrets[1]), null);
  assert.equal(open(env, 2, secrets[0]), null);
});

test('a tampered envelope does not open', () => {
  const env = seal(ua, pubs);
  const bad = env.slice(0, -4) + (env.endsWith('00') ? 'ff' : '00') + env.slice(-2);
  assert.equal(open(bad, 2, secrets[2]), null);
  assert.equal(open('0x02' + env.slice(4), 0, secrets[0]), null);
});

test('memo binds chain, order and taker', () => {
  assert.equal(memoFor(5042002, 7, '0xABCDEFabcdef0000000000000000000000000001'), 'stowaway:5042002:7:0xabcdefabcdef0000000000000000000000000001');
});

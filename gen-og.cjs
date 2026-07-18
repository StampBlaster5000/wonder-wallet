/**
 * Wonder Wallet — build-time OG card generator (CommonJS so NODE_PATH resolves
 * the GLOBAL satori + @resvg/resvg-js modules).
 * Run: NODE_PATH=$(npm root -g) node gen-og.cjs
 * Output: public/og.png (1200×630), a genuine branded card served as static.
 */
const fs = require('node:fs');
const path = require('node:path');
const satoriMod = require('satori');
const satori = satoriMod.default || satoriMod;
const { Resvg } = require('@resvg/resvg-js');

const FONTS = '/usr/share/fonts/truetype/liberation';
const serif = fs.readFileSync(`${FONTS}/LiberationSerif-Bold.ttf`);
const sans = fs.readFileSync(`${FONTS}/LiberationSans-Regular.ttf`);
const sansB = fs.readFileSync(`${FONTS}/LiberationSans-Bold.ttf`);

const GOLD2 = '#F4D58D';
const TEXT = '#ECE8E1';
const MUTED = '#9a93a6';

const chip = (label, color) => ({
  type: 'div',
  props: {
    style: {
      display: 'flex', alignItems: 'center', fontSize: 26, fontFamily: 'WW-SansB',
      color, padding: '10px 22px', borderRadius: 999,
      border: `1px solid ${color}55`, background: `${color}14`,
    },
    children: label,
  },
});

const tree = {
  type: 'div',
  props: {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '64px 70px',
      backgroundColor: '#0a0a0f',
      backgroundImage:
        'radial-gradient(800px 500px at 12% -5%, rgba(224,180,83,0.16), transparent 60%), radial-gradient(700px 480px at 92% 10%, rgba(139,92,246,0.20), transparent 60%)',
      color: TEXT, fontFamily: 'WW-Sans',
    },
    children: [
      {
        type: 'div',
        props: {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
          children: [
            {
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', gap: 26 },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        width: 104, height: 104, borderRadius: 999, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        backgroundImage: 'radial-gradient(circle at 50% 32%, #F4D58D, #E0B453 55%, #9a6f1f)',
                        color: '#2a1c04', fontFamily: 'WW-Serif', fontSize: 62,
                      },
                      children: 'W',
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'column' },
                      children: [
                        { type: 'div', props: { style: { fontFamily: 'WW-Serif', fontSize: 72, color: GOLD2, lineHeight: 1 }, children: 'Wonder Wallet' } },
                        { type: 'div', props: { style: { fontSize: 26, color: MUTED, marginTop: 8 }, children: 'Secured by Emblem Vault' } },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', fontFamily: 'WW-SansB', fontSize: 27, color: '#4ade80', padding: '13px 30px', borderRadius: 999, border: '2px solid #4ade8066', background: '#4ade801a', letterSpacing: 3 },
                children: 'BETA · LIVE',
              },
            },
          ],
        },
      },
      {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column', gap: 18 },
          children: [
            { type: 'div', props: { style: { fontFamily: 'WW-Serif', fontSize: 56, lineHeight: 1.1, maxWidth: 1010, color: TEXT }, children: 'The collector’s self-custodial wallet.' } },
            { type: 'div', props: { style: { fontSize: 30, color: MUTED, maxWidth: 1000, lineHeight: 1.35 }, children: 'BTC · ETH · SOL from one seed — Counterparty, Stamps & SRC-20 first-class, asset-aware UTXO control, native Emblem Vault bridging.' } },
          ],
        },
      },
      {
        type: 'div',
        props: {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
          children: [
            {
              type: 'div',
              props: {
                style: { display: 'flex', gap: 14 },
                children: [chip('Bitcoin', GOLD2), chip('Ethereum', '#a78bfa'), chip('Solana', '#4ade80')],
              },
            },
            { type: 'div', props: { style: { fontFamily: 'WW-SansB', fontSize: 24, color: MUTED }, children: 'wonder · v0.30.3 · beta' } },
          ],
        },
      },
    ],
  },
};

(async () => {
  const svg = await satori(tree, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'WW-Serif', data: serif, weight: 600, style: 'normal' },
      { name: 'WW-Sans', data: sans, weight: 400, style: 'normal' },
      { name: 'WW-SansB', data: sansB, weight: 700, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  const out = path.join(__dirname, 'public', 'og.png');
  fs.writeFileSync(out, png);
  console.log('[gen-og] wrote', out, png.length, 'bytes');
})();

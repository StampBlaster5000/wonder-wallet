/* Wonder Wallet — WonderSign: the ONE universal sign-&-broadcast boundary.

   Every flow (BTC send, Counterparty, swaps, minting, connected dApps, ETH, SOL, Ledger) routes
   through here so the SAME mandatory verification runs and the SAME confirm screen is shown before
   any key touches a transaction or message. This is the durable fix for the 2026-08 pentest's #1
   theme — "no single mandatory signing-verification boundary; policy scattered per-route."

   Two layers:
     • run(steps)      — PURE async orchestration (Node-testable). Guarantees verify() passes BEFORE
                         sign() is ever called, and sign() before broadcast(). Fail-closed.
     • review(spec)    — the browser confirm UI: consistent header + "what's being signed" rows +
                         the green WonderVerify banner + Back→Close/✕ seal after broadcast.

   Builds on window.WonderVerify (fail-closed local re-decode) — see verifier.js. */
(function () {
  'use strict';

  // ── Pure orchestration — the security guarantee, unit-tested in tests/wonder-sign.cjs ──
  // verify() runs first and MUST resolve with {ok:true}; if it throws or isn't ok, sign() never runs.
  // This is the mandatory boundary: nothing gets signed that wasn't just re-verified against intent.
  async function run(steps) {
    steps = steps || {};
    if (typeof steps.verify !== 'function') throw new Error('WonderSign: no verifier supplied — refusing to sign.');
    const report = await steps.verify();                 // throws on any failure → propagates, sign never called
    if (!report || report.ok !== true) throw new Error('WonderSign: verification did not pass — nothing signed.');
    if (typeof steps.sign !== 'function') throw new Error('WonderSign: no signer supplied.');
    const signed = await steps.sign(report);             // local engine / connected wallet / Ledger
    if (typeof steps.broadcast !== 'function') return { report, signed };
    const out = await steps.broadcast(signed);
    return Object.assign({ report, signed }, out || {});
  }

  // Default verifier for BTC/Counterparty composes: the existing fail-closed WonderVerify boundary.
  // Returns a thunk so review() can re-run it fresh at click time (time-of-use recheck the audit wants).
  function defaultVerify(compose, intent) {
    return function () {
      if (typeof window === 'undefined' || !window.WonderVerify) throw new Error('WonderSign: verifier unavailable — refusing to sign.');
      return window.WonderVerify.verify(compose, intent || {});
    };
  }

  // ── Browser confirm UI ──
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function ensureModal() {
    let m = $('#wsModal');
    if (!m) {
      m = document.createElement('div'); m.id = 'wsModal'; m.className = 'modal';
      m.innerHTML = '<div class="modal-card ws-card" id="wsCard"></div>';
      document.body.appendChild(m);
    }
    return m;
  }
  function rowsHtml(rows) {
    return (rows || []).map((r) =>
      r.full
        ? `<div class="m-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="k">${esc(r.k)}</span><span class="v vmono" style="font-size:11px;word-break:break-all">${esc(r.v)}</span></div>`
        : `<div class="m-row"><span class="k">${esc(r.k)}</span><span class="v${r.mono ? ' vmono' : ''}">${esc(r.v)}</span></div>`
    ).join('');
  }

  // review(spec) → resolves { txid, report, signed } on broadcast, or null if cancelled.
  // spec: { title, subtitle, rows:[{k,v,mono,full}], compose, intent, verify?, sign, broadcast?,
  //         cta, doneText, explorerTx?, onDone? }
  // If `verify` is omitted, defaults to WonderVerify over `compose`+`intent` (fail-closed).
  function review(spec) {
    if (!isBrowser) return Promise.reject(new Error('WonderSign.review requires a browser DOM'));
    spec = spec || {};
    const verify = spec.verify || (spec.compose ? defaultVerify(spec.compose, spec.intent) : null);
    return new Promise((resolve) => {
      const m = ensureModal(); const card = $('#wsCard', m);
      let done = false;
      const close = (val) => { if (done && !val) { /* already sealed */ } m.hidden = true; resolve(val || null); };
      card.innerHTML = `
        <div class="cc-head"><div><h3 class="m-title" style="margin:0">${esc(spec.title || 'Confirm')}</h3>${spec.subtitle ? `<div class="cp-addr">${esc(spec.subtitle)}</div>` : ''}</div></div>
        <div class="m-rows">${rowsHtml(spec.rows)}</div>
        <div id="wsVerify" class="ws-verify"><span class="fine">Verifying against your intent…</span></div>
        <div id="wsStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="wsBack">Back</button><button class="primary" id="wsGo" disabled>${esc(spec.cta || 'Sign & broadcast')}</button></div>`;
      m.hidden = false;
      const back = $('#wsBack', card), go = $('#wsGo', card), vbox = $('#wsVerify', card), status = $('#wsStatus', card);
      back.onclick = () => close(null);
      if (typeof verify !== 'function') { vbox.innerHTML = '<div class="ws-fail">⚠ No verifier — signing blocked.</div>'; return; }

      // Up-front verification just to render the banner / enable the CTA. The BINDING recheck happens
      // again at click time inside run() (fresh coin-control / lock / permission state).
      Promise.resolve().then(verify).then((rep) => {
        if (!rep || rep.ok !== true) throw new Error('Verification did not pass.');
        vbox.innerHTML = (window.WonderVerify && window.WonderVerify.bannerHtml) ? window.WonderVerify.bannerHtml(rep) : '<div class="cp-verified">✓ Verified</div>';
        go.disabled = false;
      }).catch((e) => {
        vbox.innerHTML = `<div class="ws-fail">⚠ ${esc(e && e.message ? e.message : 'Verification failed — signing is blocked.')}</div>`;
        go.disabled = true; // fail-closed
      });

      go.onclick = async () => {
        go.disabled = true; back.disabled = true;
        status.hidden = false; status.className = 'statusline load'; status.textContent = 'Verifying & signing…';
        try {
          const res = await run({ verify, sign: spec.sign, broadcast: spec.broadcast }); // re-verifies fresh, then signs
          done = true;
          const txid = res.txid;
          const link = (txid && spec.explorerTx) ? `<a href="${esc(spec.explorerTx(txid))}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>` : (txid ? esc(String(txid).slice(0, 24)) : '');
          status.className = 'statusline'; status.innerHTML = `${esc(spec.doneText || 'Broadcast ✓')}${link ? ' — ' + link : ''}`;
          seal(card, () => close(res));
          if (typeof spec.onDone === 'function') { try { spec.onDone(res); } catch (_) {} }
        } catch (e) {
          status.className = 'statusline err'; status.textContent = 'Blocked: ' + (e && e.message ? e.message : 'sign/broadcast error');
          back.disabled = false; go.disabled = false; // nothing broadcast on a pre-broadcast failure → safe to retry
        }
      };
    });
  }

  // After broadcast the action is irreversible — swap Back/CTA for a single Close and add an ✕ to the
  // header (no false "Back"). Reuses the .mkt-x styling.
  function seal(card, onClose) {
    if (!card) return;
    const head = card.querySelector('.cc-head');
    if (head && !head.querySelector('.mkt-x')) {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'mkt-x'; x.textContent = '×'; x.title = 'Close'; x.setAttribute('aria-label', 'Close'); x.onclick = onClose; head.appendChild(x);
    }
    const btns = card.querySelector('.wbtns');
    if (btns) { btns.innerHTML = '<button class="primary">Close</button>'; btns.querySelector('button').onclick = onClose; }
  }

  const API = { run, review, defaultVerify, seal };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; // Node (regression tests)
  if (isBrowser) window.WonderSign = API;                                    // Browser (Terminal + extension)
})();

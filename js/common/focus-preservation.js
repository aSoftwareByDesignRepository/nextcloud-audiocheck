/**
 * Check family — focus preservation across container rebuilds (CANONICAL).
 *
 * SSOT: nextcloud/apps/_shared/focus-preservation/focus-preservation.js
 * Per-app copies under apps/<app>/js/common/focus-preservation.js are
 * VERBATIM syncs — never edit them directly. Re-sync + drift check:
 *   python3 nextcloud/apps/_shared/focus-preservation/sync_focus_preservation.py
 *   python3 nextcloud/apps/_shared/focus-preservation/sync_focus_preservation.py --check
 *
 * Hardened across the audiocheck/customercheck focus-rescue saga
 * (~23 critic rounds, ~30 attack classes). The invariants are DOM-level,
 * not event-level — do not "simplify" by filtering event shapes:
 *   - enumerate STATES, not events/entry points: any real focus landing
 *     invalidates the arm; any real leave invalidates it; untrusted
 *     traffic (ev.isTrusted === false) is never evidence;
 *   - snapshot the SUPERSET at arm time (all elements, not only
 *     FOCUSABLE matches — a <div> promoted via tabIndex post-wipe must
 *     not read as "new");
 *   - identity is recorded AT ARM TIME; contains() on detached trees is
 *     forgeable by reparenting — never evaluate DOM relations lazily;
 *   - trusted-intent timestamps are verified against outcome and fenced
 *     by pointerup/keyup (a bare Escape or prevented pointerdown must not
 *     keep a poisoned intent alive; setTimeout(0) cannot fence a gesture
 *     spanning multiple tasks);
 *   - bounded lists refuse new entries at saturation; permanent taint
 *     lives in a WeakSet, never in an array that can shift()/evict.
 * Probes: apps/_shared/e2e/focus-preservation-contract.js +
 * apps/<app>/tests/e2e/focus-preservation.contract.spec.js.
 *
 * @copyright Copyright (c) 2024, Nextcloud GmbH
 * @license AGPL-3.0-or-later
 */
(function () {
  'use strict';

  const FOCUSABLE = 'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // A FOCUSABLE selector match is not necessarily focusable right now:
  // controls inside a closed <details> (except its summary), disabled
  // controls (including fieldset[disabled] descendants — :disabled covers
  // the inherited case), inert subtrees, hidden subtrees, and non-rendered
  // (display:none / visibility:hidden) elements all silently reject
  // focus().
  const isFocusable = (el) => {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    if (el.matches(':disabled')) return false;
    if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    const closed = el.closest('details:not([open])');
    if (closed && el !== closed.querySelector(':scope > summary')) return false;
    if (!el.getClientRects().length) return false; // display:none subtree
    const v = getComputedStyle(el).visibility;
    if (v === 'hidden' || v === 'collapse') return false;
    return true;
  };

  /**
   * Install the rebuild focus-rescue observer for one app.
   *
   * Re-renders that wipe a container (panel.innerHTML/outerHTML refresh,
   * replaceChildren, list rebuilds) destroy the focused node and browsers
   * dump focus to <body>. Track the last in-app focus target; when it is
   * detached by a rebuild, move focus to the rebuilt equivalent — same
   * control signature (aria-label/text) if it survived, else the same
   * child path, else the container's first focusable.
   *
   * Idempotent: a document-level flag per prefix prevents a second
   * install from a twice-run boot path creating a racing observer.
   *
   * @param {object} opts
   * @param {string} opts.prefix app token prefix ('ac', 'crm', ...)
   * @param {string} [opts.mainContentId] default `${prefix}-main-content`
   * @param {string} [opts.pageActionsId] default `${prefix}-page-actions`
   * @param {string[]} [opts.rootIds] root fallback chain,
   *   default ['app-content', mainContentId]
   */
  function install(opts) {
    const prefix = (opts && opts.prefix) || 'check';
    const flagKey = `${prefix}FocusObs`;
    const mainContentId = (opts && opts.mainContentId) || `${prefix}-main-content`;
    const pageActionsId = (opts && opts.pageActionsId) || `${prefix}-page-actions`;
    const rootIds = (opts && opts.rootIds) || ['app-content', mainContentId];
    const blurredKey = `__${prefix}BlurredEls`;
    const guardKey = `__${prefix}FocusGuard`;
    const resolveRoot = () => {
      for (const id of rootIds) {
        const el = document.getElementById(id);
        if (el) return el;
      }
      return null;
    };

    // init() is invoked once on DOMContentLoaded AND again by every
    // js/pages/*.js boot — a second install would create a second
    // observer/listener set with an independent arm closure. Two live
    // observers race the same wipes: the second instance's arm is not
    // flagged provisional (its own pending was never armed), so a
    // genuine leave disarms only one of them and the survivor lands
    // a late rebuild — a focus steal. The flag lives on the document
    // so even a twice-included script cannot duplicate the watcher.
    if (document.documentElement.dataset[flagKey] === '1') return;
    document.documentElement.dataset[flagKey] = '1';
    // Multi-phase rebuilds (wipe → fetch → render) can leave no focusable
    // equivalent in the first mutation batch. Keep the arm for a bounded
    // window so a late-arriving rebuilt control can take focus; expire
    // honestly instead of holding a stale arm that could steal a later
    // intentional body-focus.
    const RETRY_MS = 2000;
    let last = null;
    // A generic (non-signature) landing keeps watching for the true
    // same-signature rebuild until the deadline — interim controls
    // painted inside the hood (spinner buttons, placeholders) must not
    // end the rescue.
    let pending = null;
    // Whether the current batch overlapped a live watch window —
    // sampled at callback ENTRY (before checkList drops proven
    // entries). landOn feeds a newborn pending the whole window
    // buffer, not just the birth batch: plants added in EARLIER
    // batches of the same window (while pending was still null on a
    // non-suspect arm) reach nobody else (NX3-NEONATE /
    // NX4-PREBIRTH).
    let watchLiveThisBatch = false;
    // Added-node records accumulated for the whole open watch window
    // — cleared when a batch arrives with no live watcher.
    let windowRecords = [];
    // A landing excused only by the carrier path rests on a snapshot:
    // the boundary was dead at excuse time. If ANY arm boundary that
    // was dead then re-enters the connected tree in a later batch,
    // the "wipe" was a relocation and the excuse was forged — the
    // landed element AND its carrier subtree are marked permanently
    // untrusted (provenForged), the landing is revoked while it still
    // holds focus, and the honest rescue re-runs. A LIST of suspects
    // is kept: a second forged landing must not evict the proof of
    // the first, and the mark must apply even when focus has already
    // moved — a revived arm may otherwise self-rescue a proven-forged
    // element (MBD-CHAIN). Watching only the excusing node is not
    // enough: resurrecting el alone proves the same forgery (ELRES).
    // And unproven suspects are not landable either — every gate
    // consults tainted(), so a live suspect cannot be re-landed by a
    // revived arm (CHREV) or laundered by reinsertion (LAUM/LAUP).
    let suspectLandings = [];
    // Nodes proven forged — landed elements AND the carrier roots
    // that smuggled them in — marked in an unbounded WeakSet. A
    // proven mark must NEVER be evicted (OVRF), so no capped array:
    // tainted() walks the ancestor chain, which makes whole forged
    // subtrees — including nodes added into them AFTER the proof —
    // permanently untrusted without any bookkeeping bound.
    const provenForged = new WeakSet();
    const markForged = (s) => {
      provenForged.add(s.landed);
      const roots = s.carrierRoots || [];
      for (let i = 0; i < roots.length; i++) provenForged.add(roots[i]);
    };
    // A candidate is untrusted while it is a live suspect, inside a
    // live suspect's carrier subtree, or inside a proven-forged root.
    // Consulted by EVERY landing path — a suspect that is merely
    // reinserted post-wipe must not land again (LAUM/LAUP), and a
    // revived arm must never self-rescue a suspect (CHREV).
    const tainted = (c) => {
      // Identity + ancestry: c itself, or any ancestor proven forged.
      // WeakSet marks never evict — the only way a forged subtree
      // member reads clean is to be outside every marked ancestor.
      for (let n = c; n; n = n.parentElement) {
        if (provenForged.has(n)) return true;
      }
      for (let i = 0; i < suspectLandings.length; i++) {
        const s = suspectLandings[i];
        if (s.landed === c || s.landed.contains(c)) return true;
        const roots = s.carrierRoots || [];
        for (let j = 0; j < roots.length; j++) {
          const r = roots[j];
          if (r === c || (r.contains && r.contains(c))) return true;
        }
      }
      return false;
    };
    // Evicted suspects lose their slot in the revivable list but NOT
    // their resurrection watch: a forged landing still holding focus
    // when its deadSet resurrects must still be yanked. Bounded;
    // entries carry the full record so the same check applies.
    let forgedWatch = [];
    // Feed a batch's additions into an arm's badAdds. While a suspect
    // arm is dormant, collectAdds never runs on it — a decoy planted
    // inside the suspect window (or post-removal inside the landing
    // batch itself) would be invisible to every newness gate on
    // revive (RVDEC). On the proof batch spare BASELINE members only:
    // the resurrected boundary's arm-time subtree stays honest, but a
    // decoy grafted into the detached boundary or a wrapper smuggling
    // a hood clone is non-baseline and must be fed (NX-GRAFT).
    const feedArmAdds = (arm, records, spareBaseline) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (!spareBaseline) {
            arm.badAdds.push(n);
            arm.badNext.push(r.nextSibling || null);
            continue;
          }
          const feedTree = (node) => {
            if (arm.baseline && arm.baseline.has(node)) {
              // Baseline member: honest arm-time content — spare it,
              // but keep walking for grafted (non-baseline)
              // descendants.
              for (const ch of node.children) feedTree(ch);
              return;
            }
            arm.badAdds.push(node);
            arm.badNext.push(node === n ? (r.nextSibling || null) : null);
          };
          feedTree(n);
        }
      }
    };
    // Bounded suspect list. On overflow the oldest unproven suspect
    // is still marked forged AND moved to the watch list: an
    // unverifiable carrier-excused landing stays untrusted rather
    // than silently laundered, and a late resurrection still revokes
    // its focus.
    const pushSuspect = (s, records) => {
      // The landing batch's own post-removal additions were never
      // collectAdds'ed for this arm — feed them now so a plant
      // appended alongside the forged landing cannot ride a revive.
      if (records) {
        feedArmAdds(s.arm, records, false);
        // The suspect window opens HERE mid-callback — this batch was
        // not accumulated at entry (the flag was false), so seed the
        // window buffer or a neonate pending born later misses it
        // (PREBIRTH).
        if (!watchLiveThisBatch) windowRecords.push(...records);
        // A pending watch armed on an unrelated arm must treat this
        // batch's adds as untrusted too (a pending sharing s.arm
        // already got them via the aliased arrays).
        if (pending && pending.badAdds !== s.arm.badAdds) {
          feedArmAdds(pending, records, true);
        }
      }
      suspectLandings.push(s);
      while (suspectLandings.length > 8) {
        const ev = suspectLandings.shift();
        markForged(ev);
        forgedWatch.push(ev);
        while (forgedWatch.length > 64) forgedWatch.shift();
      }
    };

    const indexPath = (container, el) => {
      const path = [];
      let n = el;
      while (n && n !== container) {
        const p = n.parentElement;
        if (!p) break;
        path.unshift(Array.prototype.indexOf.call(p.children, n));
        n = p;
      }
      return path;
    };
    const signature = (el) =>
      el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 80);

    document.addEventListener('focusin', (ev) => {
      const root = resolveRoot();
      // Untrusted FocusEvents never move focus — honoring a synthetic
      // focusin would arm/disarm on a lie (rescue-kill class).
      if (!ev.isTrusted) return;
      // Focus moving off the interim landing (or anywhere else) ends the
      // pending same-signature watch — the user moved on or the real
      // rebuild just landed (its own focusin clears it again below).
      if (pending && ev.target !== pending.landedOn) pending = null;
      if (!root) {
        // The app root itself is gone (full router rebuild). Any real
        // focus landing while the app does not exist is out-of-app by
        // definition — the arm is stale.
        last = null;
        return;
      }
      // instanceof Element (not HTMLElement): a focus landing on an
      // in-root SVGElement or other non-HTML node is still a real
      // in-root landing — it must reach the waypoint disarm below or a
      // stale arm survives a <svg tabindex=0> → blur → wipe steal.
      if (!(ev.target instanceof Element)) return;
      if (!root.contains(ev.target)) {
        // Focus landed OUTSIDE the app root (NC chrome, body-level dialog,
        // or a mid-dispatch redirect/reparent that produced no earlier
        // disarmable event). Any arm is stale — a later body-focus + wipe
        // must not resurrect it.
        last = null;
        return;
      }
      const el = ev.target;
      if (!(el instanceof HTMLElement) || !el.matches(FOCUSABLE)) {
        // A real in-root focus landing on a non-actionable waypoint —
        // tabindex="-1" containers such as #<prefix>-main-content, which
        // _restoreModalFocus targets on every modal close and skip links
        // point at — means focus intentionally left last.el. The arm is
        // stale: drop it or a later body-focus + wipe resurrects it.
        last = null;
        return;
      }
      const container = el.closest(`ul, ol, tbody, [role="list"], [role="group"], #${pageActionsId}, main, #app-content`) || root;
      // Record the ancestor chain NOW — with each node's index in its
      // parent: a detached node's parentElement is null, so after a wipe
      // there is no way to walk up to the nearest surviving region nor to
      // reconstruct where the wiped neighbourhood used to sit.
      const ancestors = [];
      let an = container.parentElement;
      let child = container;
      while (an && an !== document.body && an !== document.documentElement) {
        ancestors.push({ node: an, idx: Array.prototype.indexOf.call(an.children, child) });
        child = an;
        an = an.parentElement;
      }
      // The new arm owns the leave-intent slot: an intent recorded for
      // a previous arm's leave must never disarm this arm.
      leaveIntentAt = -1;
      // Arm-time snapshot: el's parent subtree is the hood anchor, and
      // the baseline is every focusable under the outermost recorded
      // ancestor (the whole app region, not just the hood — a dead
      // container's hood can resolve onto foreign subtrees, and
      // pre-existing decoys anywhere in the region must stay
      // ineligible). Candidates must be genuinely new: not in the
      // baseline and not seen arriving inside the still-live container
      // before the wipe (badAdds).
      // The neighbourhood is the component subtree, not the leaf's
      // immediate parent: for a loose control that is the wrapper
      // directly below the container (wrap>div>div>button → wrap); for
      // a list row it is the row (ul>li>button → li). A rebuild inside
      // the wrapper is in-hood; a same-label control in a sibling
      // subtree of the container is a decoy.
      let hoodNode = el;
      while (hoodNode !== container && hoodNode.parentElement
          && hoodNode.parentElement !== container) {
        hoodNode = hoodNode.parentElement;
      }
      const baseRoot = ancestors.length ? ancestors[ancestors.length - 1].node : (hoodNode || root);
      // Baseline = EVERY element under the outermost recorded ancestor,
      // not only FOCUSABLE matches — a pre-existing <div> promoted via
      // tabIndex post-wipe would otherwise escape the newness check and
      // read as a rebuild.
      const baseline = new Set();
      if (baseRoot && baseRoot.querySelectorAll) {
        baseline.add(baseRoot);
        for (const c of baseRoot.querySelectorAll('*')) baseline.add(c);
      }
      // Ancestor tag-path of el inside its container, INCLUSIVE
      // (bottom-up: parent … container). A pre-removal added subtree
      // that becomes the hood (the double-buffer swap) is only excused
      // for candidates whose inner tag-path is a bottom-up prefix of
      // this — a real rebuild re-renders the same template; a planted
      // decoy doesn't.
      const innerTags = [];
      for (let n = el.parentElement; n; n = n.parentElement) {
        innerTags.push(n.tagName);
        if (n === container) break;
      }
      last = {
        el, container, sig: signature(el), path: indexPath(container, el),
        ancestors, hoodNode, baseline, innerTags,
        badAdds: [], badNext: [], removedRoots: [],
        // Observer-placed provisional landing (a non-sig interim the
        // rescue focused while the real rebuild is pending): a trusted
        // leave-intent disarms it outright — the user never chose this
        // element.
        provisional: !!(pending && pending.landedOn === el),
      };
      // Mutation records queued before this arm describe pre-arm DOM —
      // drain them so a decoy appended just before the arm cannot slip
      // into the first delivered batch and read as pre-wipe evidence.
      // They are still evidence for LIVE suspect arms, though — a plant
      // appended just before a mid-window refocus must not escape the
      // dormant arms' badAdds (NX-DRAIN).
      const drained = observer.takeRecords();
      for (const s of suspectLandings) feedArmAdds(s.arm, drained, false);
      for (const s of forgedWatch) feedArmAdds(s.arm, drained, false);
      if (suspectLandings.length || forgedWatch.length) {
        // Drained records never reach the observer callback —
        // accumulate them into the window buffer too, or a pending
        // born later in this window misses them.
        windowRecords.push(...drained);
        if (pending) feedArmAdds(pending, drained, true);
      }
    }, true);

    // Trusted leave-intent. Post-leave DOM evidence cannot distinguish
    // "the removal caused the blur" from "a listener or timer removed the
    // node after a genuine leave" — a wipe and a click-outside teardown
    // produce identical mutation records. The only honest signal is the
    // trusted input event that precedes the focusout: a primary-button
    // pointer press outside the tracked element, or a navigation key.
    let leaveIntentAt = -1;
    const INTENT_MS = 800;
    const armIntent = (ev) => {
      leaveIntentAt = ev.timeStamp;
    };
    // The gesture boundary, not a task boundary: real input arrives as
    // separate tasks (pointerdown → mousedown → focusout → mouseup →
    // pointerup), so a next-task reaper would clear the intent before
    // the gesture's own focusout can consume it. The up event is the
    // honest end of the press/key gesture — a prevented press, a
    // pointerdown that suppresses the compat mousedown, or a bare
    // Escape all produce it, so the intent can never outlive its
    // gesture and poison a later unrelated removal-blur.
    const releaseIntent = (ev) => {
      if (ev.isTrusted) leaveIntentAt = -1;
    };
    document.addEventListener('pointerup', releaseIntent, true);
    document.addEventListener('mouseup', releaseIntent, true);
    document.addEventListener('keyup', releaseIntent, true);
    const outside = (t, el) => !(t instanceof Node) || (el && t !== el && !el.contains(t));
    document.addEventListener('pointerdown', (ev) => {
      if (!ev.isTrusted) return;
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const t = ev.target;
      // A trusted press outside the provisional landing is a leave even
      // when it produces no focus event (focus already dumped to body
      // by the interim's own wipe): the pending watch dies or a late
      // same-signature rebuild yanks focus after the user disengaged.
      if (pending && pending.landedOn && outside(t, pending.landedOn)) pending = null;
      if (!last || !outside(t, last.el)) return;
      // The tracked element was observer-placed (a provisional interim
      // the user never chose): the press disarms it — its own rescue
      // paths must not later land the late rebuild.
      if (last.provisional) { last = null; return; }
      armIntent(ev);
    }, true);
    document.addEventListener('keydown', (ev) => {
      if (!ev.isTrusted) return;
      if (ev.key !== 'Tab' && ev.key !== 'Escape') return;
      // Tab moves focus, Escape dismisses — both are leave intent for a
      // provisional watch regardless of where focus lands.
      if (pending) pending = null;
      if (!last) return;
      if (last.provisional) { last = null; return; }
      armIntent(ev);
    }, true);
    // A prevented default action means the press/key did not intend to
    // move focus (mousedown.preventDefault suppresses the focus change).
    // Bubble phase — after target handlers have had their say — clears
    // the intent so a coincident wipe inside the window still rescues.
    // The task-boundary re-check above covers preventers ordered after
    // these listeners (window-bubble, later document handlers).
    document.addEventListener('mousedown', (ev) => {
      if (ev.isTrusted && ev.defaultPrevented) leaveIntentAt = -1;
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.isTrusted && ev.defaultPrevented) leaveIntentAt = -1;
    });

    // Disarm rules. An el.blur() call and the removal-blur the browser
    // fires when a wipe detaches a focused element produce byte-identical
    // focusout events (rt=null, activeElement=body, isConnected=true), so:
    //   1. explicit .blur() — the only unambiguous "unfocus on purpose" —
    //      is flagged via a narrow HTMLElement.prototype.blur wrap and
    //      disarms synchronously (a same-task blur()+rebuild can't steal).
    //      Only a blur on the actually-focused element is flagged — a
    //      no-op .blur() on an unfocused node must not poison it — and the
    //      flag lives only for the synchronous focusout dispatch inside
    //      the blur() call, so every listener sees it and a refocused
    //      element keeps its rescue rights.
    //   2. focusout into a real element outside the app root (NC header,
    //      body-level dialog) is an intentional leave — disarm now; the
    //      observer must not later yank focus back.
    //   3. rt === null is the ambiguous case:
    //      (a) State-change blur — the focused element itself was just
    //          disabled, hidden, inerted or closed inside <details>. The
    //          attribute applies BEFORE the blur fires, so isFocusable()
    //          is already false at dispatch: decidable NOW — an
    //          involuntary loss; the attribute observer rescues when the
    //          element becomes focusable again.
    //      (b) Removal-blur vs genuine leave — indistinguishable at
    //          dispatch (both rt=null, isConnected=true; Blink blurs
    //          before detaching). The call stack cannot decide either:
    //          unwrapped mutation paths, cross-realm calls,
    //          DocumentFragment ops and blur-without-focusout all bypass
    //          stack tracking. Decide one task later, when the mutation
    //          observer has processed the batch and activeElement is
    //          truthful: element gone/removed/unfocusable → involuntary
    //          (keep the arm); element healthy, focus elsewhere/body →
    //          real leave (disarm).
    const blurredEls = window[blurredKey] || (window[blurredKey] = new WeakSet());
    if (!HTMLElement.prototype.blur[guardKey]) {
      const origBlur = HTMLElement.prototype.blur;
      const wrapped = function () {
        const active = this === document.activeElement;
        if (active) blurredEls.add(this);
        try {
          return origBlur.call(this);
        } finally {
          if (active) blurredEls.delete(this);
        }
      };
      wrapped[guardKey] = true;
      HTMLElement.prototype.blur = wrapped;
    }
    document.addEventListener('focusout', (ev) => {
      // Synthetic FocusEvents are untrusted — honoring one on the still-
      // focused tracked element poisons the rescue (rt=null → microtask
      // disarm, rt=out-of-root → sync disarm, then a real wipe dumps to
      // body). Real focusouts are always trusted.
      if (!ev.isTrusted) return;
      // A genuine leave off the provisional landing must end the pending
      // sig-watch — dead-space clicks blur to body (Chromium fires no
      // focusin for body), explicit .blur() and Tab-away all arrive here.
      // Trusted leave evidence decides NOW: an explicit blur() on the
      // interim or a fresh leave-intent is a real leave even when the
      // leave's own teardown detaches the interim in the same task —
      // isConnected alone cannot tell those apart.
      if (pending && ev.target === pending.landedOn) {
        const interim = pending.landedOn;
        if (blurredEls.has(interim)
            || (leaveIntentAt >= 0 && ev.timeStamp - leaveIntentAt < INTENT_MS)) {
          leaveIntentAt = -1;
          pending = null;
        } else {
          // No trusted leave signal: Blink fires the blur BEFORE detach,
          // so defer the leave-vs-wipe decision past the mutation batch
          // (the observer's delivery microtask is already queued ahead of
          // ours — removedRoots is truthful when this runs). Detached, or
          // passed through a removal record this task (move/reinsert):
          // the interim itself was wiped — keep watching for the rebuild.
          const watch = pending;
          const rrAt = (watch.removedRoots || []).length;
          queueMicrotask(() => {
            if (pending !== watch || document.activeElement === interim) return;
            if (!interim.isConnected) return;
            const rr = watch.removedRoots || [];
            for (let i = rrAt; i < rr.length; i++) {
              if (rr[i] === interim || rr[i].contains(interim)) return;
            }
            pending = null;
          });
        }
      }
      if (!last || ev.target !== last.el) return;
      if (blurredEls.has(ev.target)) {
        last = null;
        return;
      }
      const rt = ev.relatedTarget;
      if (rt instanceof HTMLElement) {
        const root = resolveRoot();
        if (!root || !root.contains(rt)) {
          last = null;
          return;
        }
        // rt was in-root at dispatch — but a later listener may detach rt
        // or redirect/reparent the landing outside the root before the
        // browser completes the move. Re-validate one microtask later: if
        // focus did not land back on the tracked element (body, an
        // out-of-root node, or a silently reparented target — any of which
        // may arrive with no focusin), the leave is real and the arm must
        // not survive.
        const el = last.el;
        queueMicrotask(() => {
          if (last && last.el === el && document.activeElement !== el) {
            last = null;
          }
        });
        return;
      }
      const el = last.el;
      // A trusted leave-intent inside the window makes this a genuine
      // leave regardless of what later listeners do to the DOM —
      // click-outside teardown, bubble-phase detachers and racing
      // rebuilds must not flip it back to a wipe.
      if (leaveIntentAt >= 0 && ev.timeStamp - leaveIntentAt < INTENT_MS) {
        leaveIntentAt = -1;
        last = null;
        return;
      }
      if (!el.isConnected) {
        // Blink dispatches a wipe-caused blur BEFORE detaching the node,
        // so detached-at-dispatch means an earlier listener removed it (or
        // an ancestor) during this dispatch. Without a trusted leave that
        // is teardown racing a wipe — keep the arm; with intent we already
        // disarmed above.
        last.wipeCaused = true;
        return;
      }
      if (!isFocusable(el)) {
        last.wipeCaused = true;
        return;
      }
      setTimeout(() => {
        if (!last || last.el !== el) return; // focusin already decided
        if (document.activeElement === el) return; // transient move — focus restored
        if (!el.isConnected || !isFocusable(el) || last.elRemoved) {
          last.wipeCaused = true;
          return;
        }
        last = null;
      }, 0);
    }, true);

    const resolveStrict = (base, idxSeq) => {
      let n = base;
      for (const i of idxSeq) {
        if (!n || !n.children || i >= n.children.length) return null;
        n = n.children[i];
      }
      return n instanceof HTMLElement ? n : null;
    };
    // Region = nearest surviving ancestor of the wiped container (or the
    // container itself while it lives). Used ONLY as the spatial bound
    // for pool collection and the reconstruction base for the
    // neighbourhood path — never as a search scope.
    const scopeOf = (arm) => {
      if (arm.container.isConnected) return arm.container;
      const appRoot = resolveRoot();
      if (arm.ancestors) {
        for (const a of arm.ancestors) {
          if (a.node.isConnected && appRoot && appRoot.contains(a.node)) return a.node;
        }
      }
      return appRoot;
    };
    // Reconstruct the neighbourhood (the removed element's parent
    // subtree) and the region->element path from the arm-time
    // ancestor/index records.
    const resolveArm = (arm) => {
      const region = scopeOf(arm);
      if (!region) return { region: null, hood: null, regionToEl: null };
      const hoodPath = arm.path.slice(0, 1);
      let hood = null;
      let regionToEl = null;
      if (arm.container.isConnected) {
        // Element identity is immune to index shifts: while the
        // recorded neighbourhood node (the container's direct child on
        // el's path) lives inside the container it IS the
        // neighbourhood — sibling churn (a prepended row moving every
        // index) cannot misresolve it. Only when it was wiped too is
        // the path reconstructed.
        if (arm.hoodNode && arm.hoodNode !== arm.container
            && arm.hoodNode.isConnected
            && arm.container.contains(arm.hoodNode)) {
          hood = arm.hoodNode;
        } else {
          // The neighbourhood node was wiped: reconstruct its slot by
          // recorded index path. No tag validation — an honest rebuild
          // may change structure (different wrapper tags) while a
          // shifted foreign subtree's contents are
          // baseline/badAdd-ineligible anyway.
          hood = resolveStrict(arm.container, hoodPath);
        }
      } else if (arm.ancestors) {
        for (let k = 0; k < arm.ancestors.length; k++) {
          if (arm.ancestors[k].node !== region) continue;
          const seq = arm.ancestors.slice(0, k + 1).map((a) => a.idx).reverse();
          hood = resolveStrict(region, seq.concat(hoodPath));
          regionToEl = seq.concat(arm.path);
          break;
        }
      }
      return { region, hood, regionToEl };
    };
    // Ancestor tag-path of el below `boundary` (bottom-up).
    const innerTagPath = (boundary, el) => {
      const tags = [];
      for (let n = el.parentElement; n && n !== boundary; n = n.parentElement) {
        tags.push(n.tagName);
      }
      return tags;
    };
    // The candidate's ancestors below the hood PLUS the hood's own tag
    // must mirror the wiped element's inner tag-path bottom-up — the
    // hood substitutes for whatever ancestor level the swap replaced,
    // so its tag is part of the structural signature. Prefix
    // (shallower) is fine — a swap may replace the container itself, so
    // the hood can sit one level shallower than the original boundary.
    // Deeper than recorded is rejected: extra wrapper levels are
    // decoy-shaped.
    const sameInnerTags = (arm, hood, c) => {
      if (!(hood instanceof HTMLElement)) return false;
      // A candidate that IS the resolved hood sits at the
      // neighbourhood's own slot (a bare loose swap): its tag must be
      // the recorded hood node's tag.
      if (c === hood) return !!(arm.hoodNode) && c.tagName === arm.hoodNode.tagName;
      const t = innerTagPath(hood, c);
      t.push(hood.tagName);
      const r = arm.innerTags || [];
      if (t.length > r.length) return false;
      for (let i = 0; i < t.length; i++) if (t[i] !== r[i]) return false;
      return true;
    };
    // A candidate is rebuild evidence iff it sits inside the search
    // scope AND is genuinely new: absent from the arm-time baseline and
    // not seen arriving before the wipe (badAdds). The carrier
    // exception: a pre-removal add that IS or CONTAINS the resolved
    // hood AND was inserted IMMEDIATELY BEFORE the doomed subtree that
    // hosted el — its add-record's nextSibling is a wipe-batch victim
    // AND one of el's ARM-TIME boundaries (el itself, the hood, the
    // container, or a recorded ancestor). Identity is checked, not
    // contains(): contains() is evaluated on the detached tree at
    // gate-check time and is forgeable — a wipe batch can reparent
    // el's subtree into an unrelated doomed sibling, manufacturing
    // containment after the fact. A pre-removal add parked anywhere
    // else (appended to the region and shifted into the hood slot by
    // the removal, or inside the still-live container) is a decoy no
    // matter how faithfully it mimics the template.
    const isArmBoundary = (arm, n) => {
      if (n === arm.el || n === arm.hoodNode || n === arm.container) return true;
      const anc = arm.ancestors || [];
      for (let i = 0; i < anc.length; i++) if (anc[i].node === n) return true;
      return false;
    };
    // Arm boundaries dead right now — snapshot taken when a
    // carrier-excused landing is recorded. Resurrection of ANY member
    // (not only the excusing node — el alone counts) in a later batch
    // proves the wipe was a relocation and revokes the landing.
    const armDeadSet = (arm) => {
      const set = [];
      const push = (n) => {
        if (n && !n.isConnected && set.indexOf(n) === -1) set.push(n);
      };
      push(arm.el); push(arm.hoodNode); push(arm.container);
      const anc = arm.ancestors || [];
      for (let i = 0; i < anc.length; i++) push(anc[i].node);
      return set;
    };
    // badAdd coverage WITH the carrier exception, factored out so the
    // same-container path fallback can apply it too — a decoy parked
    // pre-wipe that slides onto the recorded index path is a decoy by
    // position, not a shifted baseline row. The boundary must be DEAD
    // (!isConnected): a move record puts a RELOCATED boundary into
    // wipeRemoved while it survives elsewhere — relocation is not death
    // and must not excuse a carrier.
    // badAdd coverage WITH the carrier exception, factored out so the
    // same-container path fallback can apply it too. Returns which arm
    // boundary excused the candidate (carrierNext) so a landing can be
    // re-verified later: the boundary must be DEAD at excuse time
    // (!isConnected), but that is only a snapshot — if the node was
    // detached into a staging subtree and reattached in a later task
    // it was RELOCATED, not wiped, and the excuse was forged.
    // A non-carrier covering entry always vetoes, whichever order the
    // records arrived in (carrier laundering cannot hide a decoy).
    const badAddVerdict = (arm, hood, c) => {
      let carrierNext = null;
      const carrierRoots = [];
      for (let i = 0; i < arm.badAdds.length; i++) {
        const n = arm.badAdds[i];
        if (n === c || n.contains(c)) {
          const next = arm.badNext[i];
          // The suspect record's resurrection watch is the only thing
          // that can still revoke a carrier landing — its capacity is
          // therefore part of the excuse: saturated tracking (64 live
          // suspects+watches) REFUSES new carrier landings rather than
          // dropping a watch (WOVFL). Expired suspects drain the count,
          // so honest swaps resume automatically.
          const carrier = hood && (n === hood || n.contains(hood))
            && next && arm.wipeRemoved
            && arm.wipeRemoved.indexOf(next) !== -1
            && !next.isConnected
            && isArmBoundary(arm, next)
            && sameInnerTags(arm, hood, c)
            && suspectLandings.length + forgedWatch.length < 64;
          if (!carrier) return { blocked: true, carrierNext: null, carrierRoots: [] };
          carrierNext = next;
          carrierRoots.push(n);
        }
      }
      return { blocked: false, carrierNext, carrierRoots };
    };
    const blockedByBadAdd = (arm, hood, c) => badAddVerdict(arm, hood, c).blocked;
    const eligible = (arm, scope, hood, c) => {
      if (!scope || (c !== scope && !scope.contains(c))) return false;
      if (tainted(c)) return false;
      if (arm.baseline && arm.baseline.has(c)) return false;
      return !blockedByBadAdd(arm, hood, c);
    };
    const hoodFocusables = (hood) => {
      const cands = hood.matches && hood.matches(FOCUSABLE) ? [hood] : [];
      for (const c of hood.querySelectorAll(FOCUSABLE)) cands.push(c);
      return cands;
    };
    // Search scope is ALWAYS the neighbourhood: for a live container it
    // is el's own parent subtree (identity — immune to index shifts); for
    // a dead hood the slot reconstruction. A same-label control anywhere
    // else in the region is a decoy by position, not the rebuilt
    // equivalent.
    const searchScopeOf = (arm, hood) => hood;
    // Land on a candidate: a non-signature landing is provisional —
    // keep the arm's search state alive as `pending` so the true
    // same-signature rebuild arriving a tick later still takes the
    // focus. Returns true on a verified landing.
    const landOn = (arm, c) => {
      if (arm.sig && signature(c) !== arm.sig) {
        pending = {
          el: arm.el,
          sig: arm.sig, container: arm.container, path: arm.path,
          ancestors: arm.ancestors, hoodNode: arm.hoodNode,
          baseline: arm.baseline, innerTags: arm.innerTags,
          // badAdds/badNext are ALIASED, not sliced: the arm's live
          // feeds (pushSuspect's landing batch, suspect-window feeds)
          // must reach the watch — a frozen copy misses birth-batch
          // plants that become landable later (NX2-PEND-BIRTH).
          badAdds: arm.badAdds, badNext: arm.badNext,
          wipeRemoved: (arm.wipeRemoved || []).slice(),
          removedRoots: (arm.removedRoots || []).slice(),
          elRemoved: true, deadline: arm.deadline || Date.now() + RETRY_MS,
          landedOn: c,
        };
        // Born inside a live watch window: collectAdds skips
        // post-removal adds and no pushSuspect runs for a plain
        // interim landing — feed the WHOLE window buffer, not just
        // the birth batch, so plants staged in earlier batches of the
        // same window stay covered (NEONATE / PREBIRTH).
        if (watchLiveThisBatch && windowRecords.length) {
          feedArmAdds(pending, windowRecords, true);
        }
      }
      c.focus({ preventScroll: true });
      if (document.activeElement === c) return true;
      if (pending && pending.landedOn === c) pending = null;
      return false;
    };
    // Among signature-equal rebuild candidates the one NEAREST the wiped
    // control's recorded index-path is the equivalent — a far-away
    // same-label control added post-removal is a decoy, not the rebuild.
    // For loose controls the container IS the whole region, so position
    // is the only identity signal left. Only meaningful while the
    // container lives (both paths share its coordinate space); a dead
    // container's hood is small enough that first-match suffices.
    const pathDistance = (a, b) => {
      let d = 0;
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const x = i < a.length ? a[i] : -1;
        const y = i < b.length ? b[i] : -1;
        d += (x === -1 || y === -1) ? 50 : Math.abs(x - y);
      }
      return d;
    };
    const findSigMatch = (arm, scope, hood) => {
      let best = null;
      let bestD = Infinity;
      let groupToggle = null;
      // Distance is measured in hood-local coordinates — el's recorded
      // index inside its parent — so a shifted sibling at the wiped
      // slot scores 0 and any other in-hood same-sig control scores by
      // its real offset.
      const local = arm.path.slice(-1);
      for (const c of hoodFocusables(scope)) {
        if (signature(c) !== arm.sig) continue;
        if (!eligible(arm, scope, hood, c)) continue;
        if (isFocusable(c)) {
          const d = pathDistance(indexPath(scope, c), local);
          if (d < bestD) { best = c; bestD = d; }
          continue;
        }
        // A rebuilt identical control inside a closed <details> group
        // can't take focus — its summary is the closest real
        // equivalent (opening restores the original). The summary
        // legitimately sits OUTSIDE scope (it heads the details that
        // contains the hood) and may be baseline — but it must still
        // reject forged and carrier-parked nodes: an ungated summary
        // re-lands a proven-forged element (GTGAP).
        const det = c.closest('details:not([open])');
        if (det && !groupToggle) {
          const sum = det.querySelector(':scope > summary');
          if (sum && isFocusable(sum) && !tainted(sum)
            && !blockedByBadAdd(arm, hood, sum)) groupToggle = sum;
        }
      }
      return { target: best, groupToggle };
    };
    // Signature search with the dead-hood fallback: when the recorded
    // neighbourhood node was wiped, a repositioned rebuild keeps its
    // identity (tag + class — a toolbar re-mounts as the same
    // component), not its index — prepended siblings shift the recorded
    // slot onto foreign content. After the slot-resolved hood yields
    // nothing, scan NEW subtrees matching the hood's identity inside the
    // surviving bound (live container, else region). Baseline and
    // badAdds still gate every candidate, so a parked or pre-existing
    // same-class decoy cannot ride along.
    const findSigMatchScoped = (arm, scope, hood, bound) => {
      const m = scope ? findSigMatch(arm, scope, hood) : { target: null, groupToggle: null };
      if (m.target || m.groupToggle) return m;
      const hn = arm.hoodNode;
      if (!hn || hn.isConnected || !hn.className || !bound) return m;
      for (const h of bound.querySelectorAll(hn.tagName)) {
        if (h === hood || h === hn || h.className !== hn.className) continue;
        const m2 = findSigMatch(arm, h, h);
        if (m2.target || m2.groupToggle) return m2;
      }
      return m;
    };
    // Removed-subtree roots seen while armed — the carrier gate's
    // adjacency proof (a swap insertBefore's nextSibling is the doomed
    // node) and the pending leave-check's wipe evidence both read it.
    const collectRemovals = (arm, records) => {
      if (!arm.removedRoots) arm.removedRoots = [];
      for (const r of records) {
        for (const n of r.removedNodes) {
          if (n instanceof Element && arm.removedRoots.length < 1000) {
            arm.removedRoots.push(n);
          }
        }
      }
    };
    // Blacklist additions recorded BEFORE the removal — anywhere in
    // the observed root, not only inside the container: a decoy parked
    // at the future hood slot from outside the container is the same
    // pre-wipe shape. Each entry keeps its add-record's nextSibling so
    // the carrier exception can prove the add was slid in immediately
    // before the doomed node (insertBefore) rather than appended and
    // shifted into the slot by the removal. The record index splits the
    // batch: additions at/after the removal record are post-wipe and
    // stay eligible.
    const collectAdds = (arm, records, removalIdx) => {
      collectRemovals(arm, records);
      // The batch that removes the tracked element is the wipe batch:
      // its removedNodes are the carrier gate's adjacency proof — a
      // swap insertBefore's nextSibling is a node that dies HERE, not
      // in some earlier or later batch.
      if (removalIdx >= 0 && !arm.wipeRemoved) {
        arm.wipeRemoved = [];
        for (const r of records) {
          for (const n of r.removedNodes) {
            if (n instanceof Element) arm.wipeRemoved.push(n);
          }
        }
      }
      for (let i = 0; i < records.length; i++) {
        const post = arm.elRemoved && (removalIdx < 0 || i >= removalIdx);
        if (post) continue;
        for (const n of records[i].addedNodes) {
          if (n instanceof Element) {
            arm.badAdds.push(n);
            arm.badNext.push(records[i].nextSibling || null);
          }
        }
      }
    };
    const observer = new MutationObserver((records) => {
      watchLiveThisBatch = !!(suspectLandings.length || forgedWatch.length);
      if (watchLiveThisBatch) {
        windowRecords.push(...records);
      } else {
        windowRecords.length = 0;
      }
      // Deferred re-verification of carrier-excused landings BEFORE the
      // idle early-return: excusing boundaries were only snapshot-dead.
      // A dead-set resurrection inside the arm window proves relocation
      // — the landed element is forged forever, and while it still
      // holds focus the landing is revoked and the arm revived so the
      // honest rescue re-runs in this batch.
      if (suspectLandings.length || forgedWatch.length) {
        const now = Date.now();
        // Nodes added while a suspect arm was dormant are not rebuild
        // evidence for it — collectAdds only feeds `last` — so a decoy
        // planted inside the suspect window would be invisible to every
        // newness gate on revive (RVDEC). Feed them as badAdds; on the
        // proof batch itself, nodes inside the resurrected boundary
        // subtrees stay honest.
        const feedAdds = (s, spareBaseline) =>
          feedArmAdds(s.arm, records, spareBaseline);
        // Shared check for live suspects AND overflow-evicted watch
        // entries: any deadSet member resurrecting inside the window
        // proves the landing was a relocation forgery.
        const checkList = (list) => {
          const keep = [];
          for (const s of list) {
            if (now > s.deadline) continue; // expired — documented bound
            if (!s.deadSet.some((n) => n.isConnected)) {
              keep.push(s); // still dead — keep watching
              continue;
            }
            // A plant arriving in the SAME batch as the proof must not
            // ride the revive either.
            feedAdds(s, true);
            // Forgery proven regardless of where focus sits now: a later
            // arm revival must never self-rescue this node or anything
            // else inside its carrier subtree.
            markForged(s);
            // Focus anywhere inside a proven-forged subtree — the
            // landed element or a carrier sibling — is revoked
            // (FORGEFOCUS).
            const ae = document.activeElement;
            if (ae && tainted(ae)) {
              if (ae.blur) ae.blur();
              pending = null;
              last = s.arm;
              if (!last.deadline) last.deadline = now + RETRY_MS;
            }
          }
          return keep;
        };
        suspectLandings = checkList(suspectLandings);
        forgedWatch = checkList(forgedWatch);
        // Surviving (still-unproven) suspects get every addition of this
        // batch — their boundaries are all still dead, so nothing here
        // can be their honest return.
        for (const s of suspectLandings) feedAdds(s, false);
        for (const s of forgedWatch) feedAdds(s, false);
        // The pending sig-watch snapshots badAdds at arm time — once
        // this batch overlapped a live watch window its adds are as
        // untrusted as the dormant arms' (NX-PEND). Feed it
        // unconditionally here: the batch that proves or expires the
        // LAST watcher still carries adversarial content — gating on
        // post-checkList lengths would starve pending on exactly that
        // batch (PENDSTARVE). Baseline sparing keeps pending's own
        // arm-time members honest.
        if (pending) feedArmAdds(pending, records, true);
      }
      if (!last && !pending) return;
      // Pending same-signature watch: a generic landing kept the arm's
      // search state alive so a late-arriving true rebuild still wins.
      if (pending) {
        collectRemovals(pending, records);
        if (Date.now() > pending.deadline) {
          pending = null;
        } else {
          const p = resolveArm(pending);
          const pScope = searchScopeOf(pending, p.hood);
          if (pScope || pending.hoodNode) {
            const pBound = pending.container.isConnected ? pending.container : p.region;
            const m = findSigMatchScoped(pending, pScope, p.hood, pBound);
            const c = m.target || m.groupToggle;
            if (c) {
              const pv = badAddVerdict(pending, p.hood, c);
              const pArm = pending;
              c.focus({ preventScroll: true });
              if (document.activeElement === c) {
                if (pv.carrierNext) {
                  pushSuspect({ arm: pArm, landed: c,
                    boundary: pv.carrierNext,
                    carrierRoots: pv.carrierRoots,
                    deadSet: armDeadSet(pArm),
                    deadline: pArm.deadline }, records);
                }
                pending = null;
              }
            }
          }
        }
      }
      if (!last) return;
      // Removal evidence for the deferred focusout decision: the records
      // are the only truthful source — the call stack cannot see
      // unwrapped paths, cross-realm calls or DocumentFragment ops. Also
      // marks transient remove+reinsert: the element came back, but
      // Blink may not restore its focus, so the arm must stay
      // wipe-caused even while isConnected is true again. The record
      // index splits the batch: additions recorded BEFORE the removal
      // inside the still-live hood are pre-wipe decoys, not rebuilds.
      let removalIdx = -1;
      if (!last.elRemoved) {
        for (let i = 0; i < records.length; i++) {
          for (const n of records[i].removedNodes) {
            if (n === last.el || (n.contains && n.contains(last.el))) {
              removalIdx = i;
              break;
            }
          }
          if (removalIdx >= 0) break;
        }
        if (removalIdx >= 0) last.elRemoved = true;
      }
      collectAdds(last, records, removalIdx);
      // Expired arms die before ANY focus write — a self-refocus or
      // equivalent landing past the retry window is a steal, so the
      // deadline is reaped before the activeElement/self-refocus paths.
      if (last.deadline && Date.now() > last.deadline) { last = null; return; }
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        // Focus sits on a real element (header chrome, dialog, another
        // control). If the tracked element is already gone, its arm is
        // stale — drop it so a later body-focus + mutation can't resurrect.
        if (!last.el.isConnected) last = null;
        return;
      }
      if (last.el.isConnected) {
        // focus on body is intentional unless the element was removed
        // (transient detach/move — Blink may not restore its focus) or
        // the blur was involuntary (wipeCaused).
        if (!last.wipeCaused && !last.elRemoved) return;
        // A revived arm may track an element that was itself a proven
        // forged carrier landing — never self-rescue it.
        if (isFocusable(last.el) && !tainted(last.el)) {
          last.el.focus({ preventScroll: true });
          if (document.activeElement === last.el) return;
        }
        // Reconnected but not (re)focusable — fall through to the
        // equivalent search.
      }
      const { region, hood, regionToEl } = resolveArm(last);
      // Never search outside the app root: when no surviving region
      // exists (app root itself mid-rebuild), wait for the app to come
      // back (deadline-bounded) instead of scanning foreign DOM.
      if (!region) {
        if (!last.deadline) last.deadline = Date.now() + RETRY_MS;
        return;
      }
      const scope = searchScopeOf(last, hood);
      let target = null;
      let groupToggle = null;
      if (last.sig && (scope || last.hoodNode)) {
        // Same-signature equivalents are only searched inside the hood
        // scope (plus dead-hood identity alternates) and only among
        // genuinely new controls — a pre-existing same-label control
        // anywhere in the app is a decoy, not the equivalent. Among the
        // survivors the candidate nearest the recorded position wins.
        const bound = last.container.isConnected ? last.container : region;
        const m = findSigMatchScoped(last, scope, hood, bound);
        target = m.target;
        groupToggle = m.groupToggle;
      }
      if (!target) target = groupToggle;
      if (!target && last.container.isConnected) {
        // Same-container wipe: the node now at the recorded path is the
        // next row shifted up — a legitimate nearest equivalent. Still
        // gated on badAdd coverage (baseline is deliberately NOT
        // checked — shifted survivors ARE baseline members); a pre-wipe
        // parked decoy that slid onto the path is not a shifted row.
        const p = resolveStrict(last.container, last.path);
        if (p && p.matches(FOCUSABLE) && isFocusable(p)
          && !tainted(p)
          && !blockedByBadAdd(last, hood, p)) target = p;
      }
      if (!target && regionToEl) {
        const p = resolveStrict(region, regionToEl);
        if (p && p.matches(FOCUSABLE) && isFocusable(p) && eligible(last, hood, hood, p)) target = p;
      }
      if (target && target.isConnected) {
        // If the winner needed the carrier exception, park the excusing
        // boundary for deferred re-verification — a later-batch
        // resurrection revokes this landing.
        const cv = badAddVerdict(last, hood, target);
        const armRef = last;
        if (landOn(last, target)) {
          if (cv.carrierNext) {
            pushSuspect({ arm: armRef, landed: target,
              boundary: cv.carrierNext,
              carrierRoots: cv.carrierRoots,
              deadSet: armDeadSet(armRef),
              deadline: (pending && pending.deadline)
                || armRef.deadline || (Date.now() + RETRY_MS) }, records);
          }
          // focus() dispatches focusin synchronously — it already
          // re-tracked the landed element as the new `last`. Do NOT
          // clear it: that would leave the rescued control as the only
          // unprotected focused element and the next rebuild phase
          // wipes it to permanent BODY.
          return;
        }
        // focus() silently rejected — the rebuild may still be mid-flight;
        // fall through to the bounded retry.
      }
      // No equivalent yet. If THIS batch rendered a genuinely focusable
      // control under root, the rebuild already happened and the control
      // is gone for good (renamed/removed) — land on the first real
      // focusable now rather than stranding the user on body. If the batch
      // only removed nodes or added non-focusable scaffolding (Loading…
      // rows painted between wipe and fetch), the rebuild is still pending
      // — keep the arm for the bounded window instead of instantly
      // grabbing an unrelated control (skip link) and permanently
      // disarming the rescue.
      const hasFocusable = (n) => {
        if (!(n instanceof HTMLElement)) return false;
        if (n.matches && n.matches(FOCUSABLE) && isFocusable(n)) return true;
        const inner = n.querySelectorAll ? n.querySelectorAll(FOCUSABLE) : [];
        for (const c of inner) { if (isFocusable(c)) return true; }
        return false;
      };
      let batchAddedFocusable = false;
      for (const r of records) {
        for (const n of r.addedNodes) {
          // Neighbourhood scope only: the rebuild detector counts
          // additions inside the wiped element's former parent subtree —
          // a focusable added anywhere else in the app is churn, not the
          // rebuild. When the hood can't be reconstructed the batch is
          // inconclusive; wait for the deadline rather than grabbing an
          // unrelated control.
          if (!hood || !(hood.contains(n) || n.contains(hood))) continue;
          if (hasFocusable(n)) { batchAddedFocusable = true; break; }
        }
        if (batchAddedFocusable) break;
      }
      if (batchAddedFocusable) {
        // Land only on genuinely new in-hood controls: a pre-existing
        // control that shifted into the hood slot and a pre-removal
        // decoy are not the rebuild.
        for (const c of hoodFocusables(hood)) {
          if (!eligible(last, hood, hood, c)) continue;
          if (!isFocusable(c)) continue;
          // focus() can silently reject even gated candidates — only
          // end the rescue on a verified landing; otherwise fall
          // through to the bounded retry. A verified landing returns
          // without clearing `last` — the synchronous focusin already
          // re-tracked the landed element.
          const cv = badAddVerdict(last, hood, c);
          const armRef = last;
          if (landOn(last, c)) {
            if (cv.carrierNext) {
              pushSuspect({ arm: armRef, landed: c,
                boundary: cv.carrierNext,
                carrierRoots: cv.carrierRoots,
                deadSet: armDeadSet(armRef),
                deadline: (pending && pending.deadline)
                  || armRef.deadline || (Date.now() + RETRY_MS) }, records);
            }
            return;
          }
        }
      }
      if (!last.deadline) last.deadline = Date.now() + RETRY_MS;
    });
    // Observe document.body: #app-content may itself be replaced on router
    // navigation, which would kill an observer bound to it. Tracking is
    // already scoped by the focusin filter above. All attributes are
    // watched without a filter: any enumerable filter misses a vector —
    // a rebuilt equivalent may become focusable via href, type,
    // contenteditable, role or any future attribute — and the callback
    // early-returns cheaply when nothing relevant changed.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  window.CheckFocusPreservation = { FOCUSABLE, isFocusable, install };
})();

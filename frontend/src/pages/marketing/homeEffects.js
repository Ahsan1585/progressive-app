// Motion and interactions for the homepage (Home.jsx), ported from the
// approved prototype. Runs once after mount. Every timer, observer and global
// listener goes through T so the returned cleanup leaves nothing running when
// the visitor navigates to another page.
import { createIcons, Check, X, ChevronRight } from 'lucide';

function tracker() {
  const timeouts = new Set(), intervals = new Set(), frames = new Set(), observers = [], listeners = [];
  return {
    timeout(fn, ms) { const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms); timeouts.add(id); return id; },
    interval(fn, ms) { const id = setInterval(fn, ms); intervals.add(id); return id; },
    raf(fn) { const id = requestAnimationFrame((t) => { frames.delete(id); fn(t); }); frames.add(id); return id; },
    io(cb, opts) { const o = new IntersectionObserver(cb, opts); observers.push(o); return o; },
    ro(cb) { const o = new ResizeObserver(cb); observers.push(o); return o; },
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); },
    clear() {
      timeouts.forEach(clearTimeout); intervals.forEach(clearInterval); frames.forEach(cancelAnimationFrame);
      observers.forEach((o) => o.disconnect());
      listeners.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
    },
  };
}

export function initHome() {
  if (typeof window === 'undefined' || !document.getElementById('eis-home')) return undefined;
  const T = tracker();
  const unscrollBody = () => { document.body.style.overflow = ''; };
  try {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const icons = () => { try { createIcons({ icons: { Check, X, ChevronRight } }); } catch { /* decorative */ } };
  const fmt = n => n.toLocaleString('en-US');

  /* ---------- Hero flow ---------- */
  const lane = $('#lane');
  let logged = 0, flagged = 0, billed = 0, total = 1284, n = 0, timer = null;
  const setM = () => { $('#mLogged').textContent = fmt(logged); $('#mFlagged').textContent = fmt(flagged); $('#mBilled').textContent = fmt(billed); $('#flowTotal').textContent = fmt(total); };
  function spawn(){
    if (!lane.isConnected || document.hidden) return;
    const d = lane.clientWidth - 58 - 24;
    if (d <= 40) return;
    n++;
    const isFlag = n % 10 === 7;
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = '<i class="ok">NOTE</i><i class="bad">FIX</i>';
    lane.appendChild(chip);
    // Counts follow what is on screen: logged when the note appears, flagged
    // the moment it turns red at the CHECK line (35% of its 6.2s run, when the
    // red layer fades in), billed the moment it clears the CHECK line. So every
    // note left of the line is logged-not-yet-billed, every note right of it is
    // billed. The line sits at the lane's centre, which a clean note's chip
    // centre reaches at exactly half its run; a flagged note bounces back to
    // 18%, then crosses the centre at 80.5% of its run once fixed.
    logged++; total++; setM();
    const DUR = isFlag ? 6200 : 3600;
    const at = (fraction, fn) => T.timeout(() => { if (chip.isConnected) { fn(); setM(); } }, Math.round(DUR * fraction));
    if (isFlag) at(0.35, () => { flagged++; });
    at(isFlag ? 0.805 : 0.5, () => { billed++; });
    const TRANSLATE = 'translate(%px,-50%)';
    const tx = x => TRANSLATE.replace('%', Math.round(x));
    let anim;
    if (isFlag){
      anim = chip.animate([
        {transform: tx(0), offset:0},
        {transform: tx(d*0.42), offset:.34},
        {transform: tx(d*0.4), offset:.42},
        {transform: tx(d*0.44), offset:.46},
        {transform: tx(d*0.18), offset:.62},
        {transform: tx(d*0.18), offset:.68},
        {transform: tx(d), offset:1}
      ], {duration:6200, easing:'linear'});
      chip.querySelector('.bad').animate([
        {opacity:0, offset:0},{opacity:0, offset:.33},{opacity:1, offset:.36},{opacity:1, offset:.64},{opacity:0, offset:.7},{opacity:0, offset:1}
      ], {duration:6200, easing:'linear'});
    } else {
      anim = chip.animate([{transform: tx(0)},{transform: tx(d)}], {duration:3600, easing:'linear'});
    }
    anim.onfinish = () => { chip.remove(); };
  }
  function staticLane(){
    const d = Math.max(lane.clientWidth - 82, 60);
    [0.08, 0.3, 0.62, 0.86].forEach((p,i) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = i===1 ? '<i class="bad" style="opacity:1">FIX</i>' : '<i class="ok">NOTE</i>';
      chip.style.transform = 'translate(' + Math.round(d*p) + 'px,-50%)';
      lane.appendChild(chip);
    });
    // two notes sit left of the CHECK line in this still frame, so logged = billed + 2
    logged = 45; flagged = 5; billed = 43; setM();
  }
  function startFlow(){ if (!timer && !reduce) { spawn(); timer = T.interval(spawn, 950); } }
  function stopFlow(){ clearInterval(timer); timer = null; }

  /* ---------- Count-ups (visible at rest, animate once on entry) ---------- */
  function countUp(el){
    if (el.dataset.done) return; el.dataset.done = '1';
    if (reduce) return;
    const end = +el.dataset.count, pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    const t0 = performance.now(), dur = 1300;
    const step = t => {
      const p = Math.min((t - t0)/dur, 1), e = 1 - Math.pow(1-p, 3);
      el.textContent = pre + fmt(Math.round(end*e)) + suf;
      if (p < 1) T.raf(step);
    };
    T.raf(step);
  }

  /* ---------- Pipeline scenes ---------- */
  const tilesEl = $('#tiles');
  for (let i=1; i<=10; i++){
    const t = document.createElement('div');
    t.className = 'tile';
    t.innerHTML = '<span>NOTE ' + String(i).padStart(2,'0') + '</span><span class="icons"><span class="ic i-ok"><i data-lucide="check"></i></span><span class="ic i-bad"><i data-lucide="x"></i></span></span>';
    tilesEl.appendChild(t);
  }
  const dotsEl = $('#dots');
  const flaggedDots = new Set([3,17,26,38,44,59,63,71,88,95]);
  for (let i=0; i<100; i++){ const d = document.createElement('i'); if (flaggedDots.has(i)) d.className = 'f'; dotsEl.appendChild(d); }

  function runLog(){
    const items = $$('#logFields li');
    const total = items.length - 1;
    if (reduce){ items.forEach(li => li.classList.add('done')); items[items.length-1].classList.add('sent'); $('#logTimer').textContent = String(total); return; }
    $('#logTimer').textContent = '0';
    items.forEach((li,i) => T.timeout(() => {
      li.classList.add('done');
      if (li.classList.contains('last')) li.classList.add('sent');
      else $('#logTimer').textContent = String(i + 1);
    }, 250 + i*300));
  }
  function runCatch(){
    const tiles = $$('.tile', tilesEl), note = $('#flagNote'), count = $('#catchCount');
    const finish = () => { tiles[6].classList.remove('flag'); tiles[6].classList.add('ok'); note.classList.add('show','is-fixed'); $('#flagText').textContent = 'Note 07 corrected by the practitioner and approved'; count.textContent = '10 of 10 clean'; };
    if (reduce){ tiles.forEach((t) => t.classList.add('ok')); finish(); return; }
    tiles.forEach((t,i) => T.timeout(() => {
      if (i === 6){ t.classList.add('flag'); note.classList.add('show'); }
      else t.classList.add('ok');
      count.textContent = (i+1) + ' of 10 checked';
    }, 250 + i*260));
    T.timeout(finish, 250 + 10*260 + 1300);
  }
  const sceneRunners = [runLog, runCatch, () => {}];
  const words = $$('.pipe-words h2');
  const caption = $('#pipeCaption');
  const sceneIO = T.io(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const s = en.target, i = +s.dataset.scene;
      words.forEach(w => w.classList.toggle('on', +w.dataset.word === i));
      caption.textContent = s.dataset.caption;
      if (!s.classList.contains('on')){ s.classList.add('on'); sceneRunners[i](s); }
    });
  }, {threshold:.55});
  $$('.scene').forEach(s => sceneIO.observe(s));

  /* ---------- Bento + counters on entry ---------- */
  const watchIO = T.io(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      if (el.matches('[data-count]')) countUp(el);
      if (el.matches('[data-watch]')){
        el.classList.add('on');
        $$('[data-count]', el).forEach(countUp);
        if (el.classList.contains('c-c')){
          if (reduce) dotsEl.classList.add('lit','is-fixed');
          else { dotsEl.classList.add('lit'); T.timeout(() => dotsEl.classList.add('is-fixed'), 1600); }
        }
      }
      watchIO.unobserve(el);
    });
  }, {threshold:.4});
  $$('.proof [data-count], #vs [data-count], [data-watch]').forEach(el => watchIO.observe(el));

  /* ---------- Chargeback versus animation ---------- */
  const stepGroups = $$('[data-steps]').map(g => $$('.st', g));
  const allSteps = stepGroups.flat();
  allSteps.forEach(s => s.classList.add('lit'));
  let vsTimers = [], vsLoop = null;
  function playVs(){
    vsTimers.forEach(clearTimeout); vsTimers = [];
    allSteps.forEach(s => s.classList.remove('lit'));
    let t = 200;
    stepGroups.forEach(group => {
      group.forEach(s => { vsTimers.push(T.timeout(() => s.classList.add('lit'), t)); t += 650; });
      t += 500;
    });
  }
  if (!reduce){
    T.io(([en]) => {
      clearInterval(vsLoop);
      if (en.isIntersecting){ playVs(); vsLoop = T.interval(playVs, 9000); }
      else { vsTimers.forEach(clearTimeout); allSteps.forEach(s => s.classList.add('lit')); }
    }, {threshold:.45}).observe($('#vs'));
  }


  /* ---------- Phone screen: scale the 375px screen to the frame, grow bars on view ---------- */
  (function(){
    const phone = document.getElementById('phoneReal'); if (!phone) return;
    const ps = phone.querySelector('.ps'), scr = phone.querySelector('.screen');
    const fit = () => { const w = scr.clientWidth; if (w) ps.style.setProperty('--ps-scale', (w / 375).toFixed(4)); };
    fit();
    if ('ResizeObserver' in window) T.ro(fit).observe(scr); else T.on(window, 'resize', fit);
    if ('IntersectionObserver' in window){
      const io = T.io(es => es.forEach(e => { if (e.isIntersecting){ phone.classList.add('in'); io.disconnect(); } }), { threshold: .35 });
      io.observe(phone);
    } else phone.classList.add('in');
  })();


  /* ---------- Log session simulator ---------- */
  (function(){
    const sim = document.getElementById('sim'); if (!sim) return;
    const phone = document.getElementById('simPhone');
    const KIDS = [
      { id:'7110000142', first:'Leo', last:'Rivera', email:'leo.parent@example.com' },
      { id:'7110000187', first:'Ava', last:'Thompson', email:'thompson.family@example.com' },
      { id:'7110000203', first:'Noah', last:'Kim', email:'kim.home@example.com' },
      { id:'7110000219', first:'Mia', last:'Santos', email:'santos.parents@example.com' },
      { id:'7110000236', first:'Ethan', last:'Carter', email:'carter.fam@example.com' },
    ];
    let kid = KIDS[0], lastFocus = null;
    const st = { status:'', location:'', group:'' };
    const q = id => document.getElementById(id);
    const views = $$('.sv', sim);
    const order = ['home','roster','form','sign','saved'];

    function setStep(name){
      const idx = order.indexOf(name);
      $$('#simSteps li').forEach(li => {
        const i = order.indexOf(li.dataset.step);
        li.classList.toggle('now', i === idx); li.classList.toggle('done', i < idx);
      });
    }
    function show(name){
      views.forEach(v => v.hidden = v.dataset.view !== name);
      setStep(name === 'child' ? 'saved' : name);
      const sc = sim.querySelector('.sv[data-view="'+name+'"] .sv-scroll'); if (sc) sc.scrollTop = 0;
      if (name === 'form') { showWizStep('details'); T.raf(sizePads); }
    }
    function fit(){
      const sw = window.innerWidth, sh = window.innerHeight;
      const guide = sw > 900 ? 300 + 64 : 0;
      const s = Math.min(1, (sh - 40) / 796, (sw - 32 - guide) / 391);
      phone.style.setProperty('--sim-scale', s.toFixed(3));
      phone.parentElement.style.width = (391 * s) + 'px'; phone.parentElement.style.height = (796 * s) + 'px';
      phone.style.transformOrigin = '0 0';
    }
    function open(){
      lastFocus = document.activeElement;
      sim.hidden = false; document.body.style.overflow = 'hidden';
      reset(); show('home'); fit();
      sim.querySelector('.sim-close').focus();
    }
    function close(){
      sim.hidden = true; document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    T.on(window, 'resize', () => { if (!sim.hidden) fit(); });
    T.on(document, 'keydown', e => { if (e.key === 'Escape' && !sim.hidden) close(); });
    $$('[data-sim-close]', sim).forEach(b => b.addEventListener('click', close));
    q('simOpen').addEventListener('click', open);
    const trig = q('phoneReal');
    trig.addEventListener('click', open);
    trig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });

    // navigation buttons inside the phone
    sim.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g){ show(g.dataset.go); } });

    // roster
    function renderKids(filter){
      const f = (filter || '').toLowerCase();
      q('simKids').innerHTML = KIDS.filter(k => !f || (k.first+' '+k.last).toLowerCase().includes(f) || k.id.includes(f)).map(k =>
        '<button type="button" class="sm-kidrow" data-kid="'+k.id+'"><span class="sm-av">'+k.first[0]+k.last[0]+'</span><span><b>'+k.first+' '+k.last+'</b><small>Child ID '+k.id+'</small></span><i data-lucide="chevron-right"></i></button>'
      ).join('') || '<div class="sm-card sm-center">No children match that search.</div>';
      icons();
    }
    q('simSearch').addEventListener('input', e => renderKids(e.target.value));
    q('simKids').addEventListener('click', e => {
      const b = e.target.closest('[data-kid]'); if (!b) return;
      kid = KIDS.find(k => k.id === b.dataset.kid);
      q('simKidName').textContent = kid.first + ' ' + kid.last;
      q('simKidAv2').textContent = kid.first[0] + kid.last[0];
      q('simParentEmail').textContent = kid.email;
      show('form'); setStep('form'); update();
    });

    // form — a true one-step-at-a-time wizard (details -> codes -> notes -> sign)
    const today = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const yesterday = () => { const d = new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(Math.floor(d.getMinutes()/5)*5).padStart(2,'0'); };
    const addMin = (hm, m) => { const [h,mi] = hm.split(':').map(Number); const t = (h*60+mi+m) % 1440; return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'); };
    const mins = () => { const a = q('fStart').value, b = q('fEnd').value; if (!a || !b) return 0; const [h1,m1]=a.split(':').map(Number),[h2,m2]=b.split(':').map(Number); return Math.max(0,(h2*60+m2)-(h1*60+m1)); };
    const fmt12 = hm => { if (!hm) return ''; let [h,m] = hm.split(':').map(Number); const ap = h>=12?'PM':'AM'; h = h%12||12; return h+':'+String(m).padStart(2,'0')+' '+ap; };

    const WSTEPS = ['details','codes','notes','sign'];
    const WNEXT_LABEL = { details:'Next: Codes', codes:'Next: Notes', notes:'Next: Sign', sign:'Save Session' };
    let wstep = 'details', how = 'person';

    function showWizStep(name){
      wstep = name;
      $$('.sm-sec[data-sec-id]', sim).forEach(sec => { sec.hidden = sec.dataset.secId !== name; });
      $$('#simFormSteps li').forEach(li => {
        const i = WSTEPS.indexOf(li.dataset.wstep), cur = WSTEPS.indexOf(name);
        li.classList.toggle('now', li.dataset.wstep === name);
        li.classList.toggle('done', i < cur);
      });
      q('simWizBack').hidden = name === 'details';
      q('simWizNext').textContent = WNEXT_LABEL[name];
      if (name === 'sign') populateReview();
      q('simFormScroll').scrollTop = 0;
      sim.querySelector('[data-view="form"]').classList.remove('sm-showerr');
      update();
    }
    sim.addEventListener('click', e => {
      const w = e.target.closest('[data-wstep]'); if (w && w.tagName === 'BUTTON' && w.id !== 'simWizBack') showWizStep(w.dataset.wstep);
    });

    $$('.sm-howcard', sim).forEach(b => b.addEventListener('click', () => {
      how = b.dataset.how;
      $$('.sm-howcard', sim).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      q('teleHint').hidden = how !== 'video';
      q('parentSigWrap').hidden = how === 'video'; q('teleNote').hidden = how !== 'video';
      update();
    }));
    q('simToday').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#simToday button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      q('fDate').value = b.dataset.day === 'today' ? today() : yesterday();
      update();
    });

    $$('.sm-opts', sim).forEach(g => g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('button', g).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      st[g.dataset.pick] = b.textContent; update();
    }));
    q('simQuick').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.q === 'now') q('fStart').value = nowHM();
      else if (q('fStart').value) q('fEnd').value = addMin(q('fStart').value, +b.dataset.q);
      update();
    });
    ['fDate','fStart','fEnd','fType'].forEach(id => q(id).addEventListener('input', update));
    q('fNote').addEventListener('input', () => { q('simCharCount').textContent = q('fNote').value.length + ' characters'; update(); });
    q('fZero').addEventListener('change', () => {
      const z = q('fZero').checked;
      q('fStart').disabled = z; q('fEnd').disabled = z; $$('#simQuick button').forEach(b => b.disabled = z);
      if (z){ q('fStart').value=''; q('fEnd').value=''; }
      update();
    });

    function populateReview(){
      q('simRevWhen').textContent = (q('fDate').value === today() ? 'Today' : 'Yesterday') + ' · ' + (q('fZero').checked ? 'Cancelled, 0 min' : fmt12(q('fStart').value) + ' to ' + fmt12(q('fEnd').value));
      q('simRevHow').textContent = how === 'video' ? 'Video (telepractice)' : 'In person';
      q('simRevType').textContent = q('fType').value || '—';
      q('simRevStatus').textContent = st.status || '—';
      q('simRevLocation').textContent = st.location ? st.location + (st.group ? ' · ' + st.group : '') : '—';
      q('simRevNotes').textContent = q('fNote').value.trim() || 'None';
    }
    const scroller = q('simFormScroll');

    // signature pads
    const pads = {};
    function sizePads(){
      ['sigParent','sigPrac'].forEach(id => {
        const c = q(id); const r = c.getBoundingClientRect(); const scale = parseFloat(getComputedStyle(phone).getPropertyValue('--sim-scale')) || 1;
        const w = Math.round(r.width / scale) || 311, h = Math.round(r.height / scale) || 132;
        if (c.width !== w * 2){ const keep = pads[id] && pads[id].has; c.width = w*2; c.height = h*2; const ctx = c.getContext('2d'); ctx.scale(2,2); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0F1B26'; pads[id] = { ctx, has: false, w, h }; if (keep) drawSaved(id); }
      });
    }
    function point(c, e){ const r = c.getBoundingClientRect(); const s = parseFloat(getComputedStyle(phone).getPropertyValue('--sim-scale')) || 1; return [(e.clientX - r.left)/s, (e.clientY - r.top)/s]; }
    ['sigParent','sigPrac'].forEach(id => {
      const c = q(id); let drawing = false;
      c.addEventListener('pointerdown', e => { sizePads(); drawing = true; c.setPointerCapture(e.pointerId); const [x,y] = point(c,e); const p = pads[id]; p.ctx.beginPath(); p.ctx.moveTo(x,y); });
      c.addEventListener('pointermove', e => { if (!drawing) return; const [x,y] = point(c,e); const p = pads[id]; p.ctx.lineTo(x,y); p.ctx.stroke(); if (!p.has){ p.has = true; c.parentElement.classList.add('has'); update(); } });
      ['pointerup','pointercancel','pointerleave'].forEach(t => c.addEventListener(t, () => { drawing = false; }));
    });
    function clearPad(id){ const p = pads[id]; if (!p) return; p.ctx.clearRect(0,0,p.w,p.h); p.has = false; q(id).parentElement.classList.remove('has'); update(); }
    $$('[data-clear]', sim).forEach(b => b.addEventListener('click', () => clearPad(b.dataset.clear)));
    function drawSaved(id, name){
      sizePads(); const p = pads[id]; if (!p) return;
      p.ctx.clearRect(0,0,p.w,p.h);
      p.ctx.save(); p.ctx.font = 'italic 600 34px "Segoe Script","Brush Script MT","Snell Roundhand",cursive'; p.ctx.fillStyle = '#0F1B26';
      p.ctx.fillText(name || 'Maya Chen', 22, p.h/2 + 10); p.ctx.restore();
      p.ctx.beginPath(); p.ctx.moveTo(20, p.h/2 + 22); p.ctx.bezierCurveTo(p.w*.35, p.h/2 + 30, p.w*.6, p.h/2 + 14, p.w - 30, p.h/2 + 24); p.ctx.stroke();
      p.has = true; q(id).parentElement.classList.add('has'); update();
    }
    q('useSaved').addEventListener('click', () => drawSaved('sigPrac', 'Maya Chen'));

    // per-step validation, same rules as the app
    function missingFor(step){
      const m = [];
      if (step === 'details'){
        if (!q('fDate').value) m.push('date');
        if (!q('fZero').checked){ if (!q('fStart').value) m.push('start'); if (!q('fEnd').value) m.push('end'); }
      } else if (step === 'codes'){
        if (!q('fType').value) m.push('type');
        if (!st.status) m.push('status');
        if (!st.location) m.push('location');
      } else if (step === 'sign'){
        if (how !== 'video' && !(pads.sigParent && pads.sigParent.has)) m.push('parent');
        if (!(pads.sigPrac && pads.sigPrac.has)) m.push('prac');
      }
      return m;
    }
    function update(){
      const z = q('fZero').checked, t = mins();
      q('fTotal').textContent = z ? '0 min (cancelled)' : t > 0 ? (t/60).toFixed(2)+' hrs ('+t+' min)' : '—';
      const m = missingFor(wstep);
      q('simStepDone').hidden = m.length > 0;
      q('simMissing').textContent = m.length ? m.length + ' field' + (m.length > 1 ? 's' : '') + ' still missing' : '';
      $$('.sm-err', sim).forEach(el => el.classList.toggle('on', m.includes(el.dataset.err)));
    }
    q('simWizBack').addEventListener('click', () => { const i = WSTEPS.indexOf(wstep); if (i > 0) showWizStep(WSTEPS[i-1]); });
    q('simWizNext').addEventListener('click', () => {
      const m = missingFor(wstep);
      sim.querySelector('[data-view="form"]').classList.add('sm-showerr');
      if (m.length){ update(); return; }
      const i = WSTEPS.indexOf(wstep);
      if (i < WSTEPS.length - 1){ showWizStep(WSTEPS[i+1]); return; }
      // final step: save
      const btn = q('simWizNext'); btn.classList.add('loading');
      T.timeout(() => {
        btn.classList.remove('loading');
        const date = new Date(q('fDate').value + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' });
        const time = q('fZero').checked ? 'Cancelled, 0 min' : fmt12(q('fStart').value) + '–' + fmt12(q('fEnd').value);
        const tele = how === 'video';
        q('simNewSession').innerHTML = '<b>'+date+' · '+time+'</b><span>'+q('fType').value+' · '+st.location+'</span><em class="sm-chip">'+(tele ? 'Awaiting parent' : 'Submitted')+'</em>';
        q('simChildBar').textContent = kid.first+' '+kid.last; q('simChildName').textContent = kid.first+' '+kid.last;
        q('simChildAv').textContent = kid.first[0]+kid.last[0]; q('simChildId').textContent = 'Child ID '+kid.id;
        if (tele){ q('simTeleEmail').textContent = kid.email; q('simTeleDone').hidden = false; }
        else { show('child'); toast('Session saved.'); }
      }, reduce ? 0 : 700);
    });
    q('simTeleOk').addEventListener('click', () => { q('simTeleDone').hidden = true; show('child'); });
    function toast(msg){ const t = q('simToast'); t.textContent = msg; t.classList.add('show'); T.timeout(() => t.classList.remove('show'), 2200); }

    function reset(){
      ['fStart','fEnd','fType','fNote'].forEach(id => { q(id).value = ''; q(id).disabled = false; });
      q('fDate').value = today(); q('fZero').checked = false;
      how = 'person'; $$('.sm-howcard', sim).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.how === 'person')));
      q('teleHint').hidden = true; q('parentSigWrap').hidden = false; q('teleNote').hidden = true;
      $$('#simToday button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.day === 'today')));
      q('simCharCount').textContent = '0 characters';
      $$('#simQuick button').forEach(b => b.disabled = false);
      $$('.sm-opts button', sim).forEach(b => b.setAttribute('aria-pressed','false')); st.status = st.location = st.group = '';
      Object.keys(pads).forEach(clearPad);
      sim.querySelector('[data-view="form"]').classList.remove('sm-showerr');
      q('simSearch').value = ''; renderKids('');
      showWizStep('details');
      update();
    }
    q('simAgain').addEventListener('click', () => { reset(); show('roster'); });
    sim.addEventListener('click', e => { if (e.target.closest('[data-book="simulator"]')) close(); });

    // "Fill it in for me": walks the real steps quickly
    q('simFill').addEventListener('click', () => {
      const v = sim.querySelector('.sv:not([hidden])').dataset.view;
      if (v === 'home' || v === 'roster' || v === 'child'){ reset(); kid = KIDS[0]; q('simKidName').textContent = 'Leo Rivera'; q('simKidAv2').textContent = 'LR'; q('simParentEmail').textContent = kid.email; show('form'); }
      q('fDate').value = today(); q('fStart').value = '09:00'; q('fEnd').value = '09:45';
      q('fType').value = 'Developmental Intervention';
      const pick = (g, label) => { const grp = sim.querySelector('[data-pick="'+g+'"]'); $$('button', grp).forEach(b => b.setAttribute('aria-pressed', String(b.textContent === label))); st[g] = label; };
      pick('status','Direct Child Service'); pick('location','Home'); pick('group','Direct Child Service - Individual');
      q('fNote').value = 'Worked on stacking blocks and two-word requests during play. Parent practiced the routine with ' + kid.first + '.';
      q('simCharCount').textContent = q('fNote').value.length + ' characters';
      showWizStep('sign');
      T.raf(() => { sizePads(); drawSaved('sigParent','J. ' + kid.last); drawSaved('sigPrac','Maya Chen'); update(); });
    });

    renderKids('');
  })();

  /* ---------- Self-check ---------- */
  const answers = {};
  const SIZE_LABEL = { s: '1 to 10', m: '11 to 30', l: 'more than 30' };
  function checkResult(){
    if (!answers.eims || !answers.sevf || !answers.size) return;
    const lines = [];
    if (answers.eims === 'none') lines.push('Mismatches reach the state before you see them. Izaya EIS checks every session note against EIMS first.');
    else if (answers.eims === 'hand') lines.push('Your team re-checks every session note against EIMS by hand. Izaya EIS does that comparison on every note.');
    else lines.push('Your spreadsheet check becomes automatic: every session note compared against EIMS.');
    if (answers.sevf === 'hand') lines.push('SEVFs and invoices are generated from the session notes, so nobody re-types them.');
    else if (answers.sevf === 'service') lines.push('You see every flag and every document yourself instead of waiting on a service.');
    else lines.push('Clean sessions generate their SEVF and invoice with no template work.');
    $('#checkOut').innerHTML = lines.join(' ') + ' <span class="muted">Set up for agencies with ' + SIZE_LABEL[answers.size] + ' practitioners.</span>';
  }
  $$('.check-q fieldset').forEach(fs => {
    fs.addEventListener('click', e => {
      const btn = e.target.closest('.opt'); if (!btn) return;
      $$('.opt', fs).forEach(o => o.setAttribute('aria-pressed', String(o === btn)));
      answers[fs.dataset.q] = btn.dataset.v;
      checkResult();
    });
  });

  /* ---------- Mobile sticky bar ---------- */
  const mbar = $('#mbar');
  const heroIO = T.io(([en]) => {
    mbar.classList.toggle('show', !en.isIntersecting && true);
    if (en.isIntersecting) startFlow(); else stopFlow();
  }, {threshold:0});
  heroIO.observe($('.hero'));

  /* ---------- Agency tabs ---------- */
  const tabs = $$('.tab'), panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  let aTimers = [], autoTimer = null, userPicked = false, agencyVisible = false, curTab = 0;
  const later = (fn, ms) => aTimers.push(T.timeout(fn, reduce ? 0 : ms));
  const runners = [
    function staff(){
      const rowNew = $('#rowNew'), newPill = $('#newPill'), rowGone = $('#rowGone'), gonePill = $('#gonePill'), goneLoad = $('#goneLoad'), toast = $('#staffToast');
      rowNew.classList.add('enter'); newPill.className = 'pill inv'; newPill.textContent = 'Invite sent';
      rowGone.classList.remove('gone'); gonePill.className = 'pill'; gonePill.textContent = 'Active'; goneLoad.textContent = '11'; toast.classList.remove('show');
      later(() => rowNew.classList.remove('enter'), 250);
      later(() => { newPill.className = 'pill'; newPill.textContent = 'Active'; }, 1500);
      later(() => {
        gonePill.className = 'pill off'; gonePill.textContent = 'Deactivated'; rowGone.classList.add('gone');
        if (reduce){ goneLoad.textContent = '0'; return; }
        let v = 11; const iv = T.interval(() => { v--; goneLoad.textContent = String(v); if (v <= 0) clearInterval(iv); }, 60); aTimers.push(iv);
      }, 2700);
      later(() => toast.classList.add('show'), 3500);
    },
    function kids(){
      const tm = $('#tmNew'); tm.classList.add('enter');
      later(() => tm.classList.remove('enter'), 600);
    },
    function rec(){
      const rows = $$('#rec div'), ex = $('#export');
      rows.forEach(r => r.classList.remove('in')); ex.classList.remove('show');
      rows.forEach((r, i) => later(() => r.classList.add('in'), 300 + i*380));
      later(() => ex.classList.add('show'), 300 + rows.length*380 + 300);
    },
    function ctl(){
      const sws = $$('#p-ctl .sw'), feed = $$('#feed div');
      sws.forEach(s => s.classList.remove('on')); feed.forEach(f => f.classList.remove('in'));
      sws.forEach((s, i) => { if (s.dataset.on === '1') later(() => s.classList.add('on'), 400 + i*300); });
      feed.forEach((f, i) => later(() => f.classList.add('in'), 1300 + i*500));
    }
  ];
  function selectTab(i, focus){
    aTimers.forEach(t => { clearTimeout(t); clearInterval(t); }); aTimers = [];
    curTab = i;
    tabs.forEach((t, j) => { const on = j === i; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; panels[j].hidden = !on; });
    if (focus) tabs[i].focus();
    runners[i]();
  }
  function scheduleAuto(){
    clearTimeout(autoTimer);
    if (reduce || userPicked || !agencyVisible) return;
    autoTimer = T.timeout(() => { selectTab((curTab + 1) % tabs.length); scheduleAuto(); }, 7000);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { userPicked = true; clearTimeout(autoTimer); selectTab(i); });
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault(); userPicked = true; clearTimeout(autoTimer);
      selectTab((i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length, true);
    });
  });
  let agencyStarted = false;
  T.io(([en]) => {
    agencyVisible = en.isIntersecting;
    if (agencyVisible && !agencyStarted){ agencyStarted = true; selectTab(0); }
    if (agencyVisible) scheduleAuto(); else clearTimeout(autoTimer);
  }, {threshold:.35}).observe($('#agency'));


  /* ---------- Init ---------- */
  icons();
  if (reduce) staticLane(); else startFlow();
  T.on(document, 'visibilitychange', () => { if (document.hidden) stopFlow(); });
  } catch (err) {
    // A broken animation must never break the page: the content is all in the markup.
    console.error('homeEffects:', err);
  }
  return () => { T.clear(); unscrollBody(); };
}

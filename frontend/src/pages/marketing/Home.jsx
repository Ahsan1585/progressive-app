// Izaya EIS homepage (izayaedge.com/eis). Ported from the approved design
// prototype: every section, the hero billing-run animation, the pipeline story,
// the agency tabs, the self-check, and the interactive "log a session" phone.
// Markup renders statically (prerendered for search engines); homeEffects.js
// adds the motion and interactions after mount and removes them on unmount.
// Uses the shared MarketingLayout, so the nav logo and footer are the site's own.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Baby,
  Badge,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  ClipboardPenLine,
  Clock,
  CornerUpLeft,
  CreditCard,
  Download,
  FileCheck2,
  FileDown,
  FilePenLine,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  History,
  House,
  Inbox,
  KeyRound,
  LayoutGrid,
  List,
  ListChecks,
  LockKeyhole,
  MailPlus,
  MapPin,
  MessageCircle,
  MessageSquareCheck,
  NotebookPen,
  PenLine,
  PenTool,
  Plus,
  Pointer,
  Repeat,
  ScanSearch,
  ScrollText,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Stethoscope,
  StickyNote,
  ToggleRight,
  User,
  UserCog,
  UserX,
  Users,
  UsersRound,
  Video,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react';
import '@fontsource-variable/geist-mono';
import '../../styles/eis-home.css';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';
import { initHome } from './homeEffects';

const ICONS = {
  'arrow-right': ArrowRight,
  'baby': Baby,
  'badge': Badge,
  'check': Check,
  'check-circle-2': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-dollar-sign': CircleDollarSign,
  'clipboard-list': ClipboardList,
  'clipboard-pen-line': ClipboardPenLine,
  'clock': Clock,
  'corner-up-left': CornerUpLeft,
  'credit-card': CreditCard,
  'download': Download,
  'file-check-2': FileCheck2,
  'file-down': FileDown,
  'file-pen-line': FilePenLine,
  'file-signature': FileSignature,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'history': History,
  'house': House,
  'inbox': Inbox,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  'list': List,
  'list-checks': ListChecks,
  'lock-keyhole': LockKeyhole,
  'mail-plus': MailPlus,
  'map-pin': MapPin,
  'message-circle': MessageCircle,
  'message-square-check': MessageSquareCheck,
  'notebook-pen': NotebookPen,
  'pen-line': PenLine,
  'pen-tool': PenTool,
  'plus': Plus,
  'pointer': Pointer,
  'repeat': Repeat,
  'scan-search': ScanSearch,
  'scroll-text': ScrollText,
  'search': Search,
  'send': Send,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  'smartphone': Smartphone,
  'sparkles': Sparkles,
  'stethoscope': Stethoscope,
  'sticky-note': StickyNote,
  'toggle-right': ToggleRight,
  'user': User,
  'user-cog': UserCog,
  'user-x': UserX,
  'users': Users,
  'users-round': UsersRound,
  'video': Video,
  'wand-sparkles': WandSparkles,
  'x': X,
  'x-circle': XCircle,
};

function Ic({ n }) {
  const C = ICONS[n];
  return C ? <C aria-hidden="true" /> : null;
}

export default function Home() {
  useEffect(() => initHome(), []);
  return (
    <MarketingLayout>
      <div id="eis-home" data-palette="ocean" data-depth="mixed">
  {/* 1. HERO */}
  <section className="tone-dark hero" id="top">
    <div className="wrap hero-grid">
      <div>
        <div className="eyebrow"><span className="ic"><Ic n="map-pin" /></span>NJ early intervention agencies</div>
        <h1>Early intervention software. <span className="accent">Automated billing that runs itself.</span></h1>
        <p className="hero-sub">Practitioners log sessions. Errors are caught automatically. Clean sessions generate SEVFs and invoices.</p>
        <div className="cta-row">
          <Link className="btn btn-primary" data-book="hero" to="/book?source=hero">Book a demo <Ic n="arrow-right" /></Link>
          
        </div>
        <p className="hero-seo">Early intervention billing software for New Jersey agencies. 30-day free pilot.</p>
      </div>

      <div className="flow" aria-label="Animated example of a billing run: sessions are logged, checked, and billed">
        <div className="flow-head">
          <span className="live"><i></i>Example billing run</span>
          <span>Sessions this month <strong className="mono" id="flowTotal">1,284</strong></span>
        </div>
        <div className="nodes">
          <div className="node"><span className="ic"><Ic n="smartphone" /></span><b>Log</b><span>Once, on a phone</span></div>
          <div className="node"><span className="ic"><Ic n="scan-search" /></span><b>Check</b><span>Rules + EIMS</span></div>
          <div className="node"><span className="ic"><Ic n="file-check-2" /></span><b>Bill</b><span>SEVF + invoice</span></div>
        </div>
        <div className="lane" id="lane" aria-hidden="true">
          <div className="gate"></div>
          <div className="gate-label">CHECK</div>
        </div>
        <div className="flow-foot">
          <div className="metric"><strong className="mono" id="mLogged">0</strong>Logged</div>
          <div className="metric flagged"><strong className="mono" id="mFlagged">0</strong>Flagged, fixed</div>
          <div className="metric billed"><strong className="mono" id="mBilled">0</strong>Billed</div>
        </div>
      </div>
    </div>
  </section>

  {/* 2. PROOF */}
  <section className="tone-light proof" aria-label="Measured results">
    <div className="wrap">
      <div className="proof-grid">
        <div className="stat fact"><span className="ic"><Ic n="list-checks" /></span><h3>Every session note checked against EIMS</h3><p>Child, practitioner, date, times, service, location and more: 11 fields compared before billing.</p></div>
        <div className="stat fact"><span className="ic"><Ic n="file-check-2" /></span><h3>Entered once, billed from the same note</h3><p>The practitioner's session note becomes the SEVF and the invoice. Nobody re-types it.</p></div>
        <div className="stat fact"><span className="ic"><Ic n="shield-alert" /></span><h3>Errors stopped before billing</h3><p>A note that doesn't match is held until it's fixed or approved.</p></div>
        <div className="stat fact"><span className="ic"><Ic n="layout-grid" /></span><h3>One place for the whole agency</h3><p>Billing, practitioners, children, staff and consent in one platform.</p></div>
      </div>
      
    </div>
  </section>

  {/* 2b. CHARGEBACKS */}
  <section className="tone-light section charge" id="chargebacks">
    <div className="wrap">
      <div className="sec-head">
        <h2>Stop chargebacks <span className="accent">before the state finds them.</span></h2>
        <p>EIS matches every session note to EIMS and fails the ones that don't match, so they're fixed before you submit.</p>
      </div>
      <div className="vs" id="vs">
        <div className="side bad tone-dark">
          <span className="who">Without a match check</span>
          <div className="huge">Hundreds of thousands</div>
          <p className="cap">lost to chargebacks on incorrectly submitted SEVFs.</p>
          <div className="steps" data-steps>
            <span className="st"><Ic n="send" />SEVF submitted</span><span className="arr"><Ic n="arrow-right" /></span>
            <span className="st"><Ic n="search" />State review</span><span className="arr"><Ic n="arrow-right" /></span>
            <span className="st red"><Ic n="circle-dollar-sign" />Chargeback</span>
          </div>
        </div>
        <div className="side good tone-dark">
          <span className="who">With Izaya EIS</span>
          <div className="huge"><span data-count="100">100</span>%</div>
          <p className="cap">of billed sessions matched to EIMS before submission.</p>
          <div className="steps" data-steps>
            <span className="st red"><Ic n="x-circle" />Note doesn't match EIMS</span><span className="arr"><Ic n="arrow-right" /></span>
            <span className="st"><Ic n="corner-up-left" />Failed and fixed</span><span className="arr"><Ic n="arrow-right" /></span>
            <span className="st green"><Ic n="check-circle-2" />Matched. Submitted.</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  {/* 3. PIPELINE */}
  <section className="tone-light section" id="pipeline">
    <div className="wrap"><h2 className="kicker">From session note to SEVF and invoice</h2></div>
    <div className="wrap pipe-grid">
      <div className="pipe-words" aria-hidden="true">
        <h2 data-word="0" className="on">Log<span className="dot">.</span></h2>
        <h2 data-word="1">Catch<span className="dot">.</span></h2>
        <h2 data-word="2">Bill<span className="dot">.</span></h2>
        <p className="pipe-caption" id="pipeCaption">A session is logged once, on any phone.</p>
      </div>

      <div className="scenes">
        <div className="scene" data-scene="0" data-caption="A session is logged once, on any phone.">
          <div className="scene-card tone-dark">
            <h2 className="scene-title">Log<span className="accent">.</span></h2>
            <p className="scene-cap">A session is logged once, on any phone.</p>
            <div className="log-wrap">
              <div className="ring">
                <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="track" cx="100" cy="100" r="90"></circle><circle className="bar" cx="100" cy="100" r="90"></circle></svg>
                <div className="ring-center"><div><strong className="mono" id="logTimer">0</strong><span>of 10 captured</span></div></div>
              </div>
              <ul className="fields" id="logFields">
                <li><span className="ic"><Ic n="baby" /></span>Child</li>
                <li><span className="ic"><Ic n="stethoscope" /></span>Service type</li>
                <li><span className="ic"><Ic n="map-pin" /></span>Location</li>
                <li><span className="ic"><Ic n="list-checks" /></span>Visit status</li>
                <li><span className="ic"><Ic n="users" /></span>Group size</li>
                <li><span className="ic"><Ic n="clock" /></span>Start and end time</li>
                <li><span className="ic"><Ic n="notebook-pen" /></span>Session narrative</li>
                <li><span className="ic"><Ic n="pen-line" /></span>Parent signature</li>
                <li><span className="ic"><Ic n="pen-tool" /></span>Practitioner signature</li>
                <li><span className="ic"><Ic n="sticky-note" /></span>Notes</li>
                <li className="last"><span className="ic"><Ic n="send" /></span>Submitted for billing</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="scene" data-scene="1" data-caption="Every session note is checked against EIMS. Only the ones with errors need a person.">
          <div className="scene-card tone-dark">
            <h2 className="scene-title">Catch<span className="accent">.</span></h2>
            <p className="scene-cap">Every session note is checked against EIMS. Only the ones with errors need a person.</p>
            <div className="tiles" id="tiles"></div>
            <div className="flag-note" id="flagNote"><span className="ic"><Ic n="corner-up-left" /></span><span id="flagText">Note 07 sent back: end time overlaps another session</span></div>
            <div className="catch-foot">
              <strong id="catchCount">0 of 10 checked</strong>
              <span>Clean notes approve themselves.</span>
            </div>
          </div>
        </div>

        <div className="scene" data-scene="2" data-caption="SEVFs and invoices build themselves. Matched against EIMS.">
          <div className="scene-card tone-dark">
            <h2 className="scene-title">Bill<span className="accent">.</span></h2>
            <p className="scene-cap">SEVFs and invoices build themselves. Matched against EIMS.</p>
            <div className="bill-wrap">
              <div className="sheets">
                <div className="sheet"><small>NJEIS form</small><b>SEVF</b><i className="ln w85"></i><i className="ln w70"></i><i className="ln"></i><i className="ln w55"></i><i className="ln w85"></i><div className="tot"><span>42 sessions</span><span className="stamp"><Ic n="check-circle-2" />Signed</span></div></div>
                <div className="sheet"><small>Invoice</small><b>INV-2026</b><i className="ln w70"></i><i className="ln w85"></i><i className="ln w55"></i><i className="ln"></i><i className="ln w70"></i><div className="tot"><span>Time + amount</span><span className="stamp"><Ic n="check-circle-2" />Ready</span></div></div>
              </div>
              <div className="eims">
                <div className="ring">
                  <svg viewBox="0 0 160 160" aria-hidden="true"><circle className="track" cx="80" cy="80" r="70"></circle><circle className="bar" cx="80" cy="80" r="70"></circle></svg>
                  <div className="ring-center"><div><strong className="mono">11/11</strong><span>fields match</span></div></div>
                </div>
                <div className="ready"><Ic n="check" />Ready to submit</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  {/* 3b. AGENCY COMMAND CENTER */}
  <section className="tone-dark section agency" id="agency" style={{"paddingTop": "0"}}>
    <div className="wrap">
      <div className="sec-head">
        <h2>Early intervention agency management. <span className="muted">Not just billing.</span></h2>
        <p>Staff, children, records, and who sees what. All in one place.</p>
      </div>

      <div className="tabs" role="tablist" aria-label="Agency features">
        <button className="tab" role="tab" id="t-staff" aria-controls="p-staff" aria-selected="true"><span className="ic"><Ic n="users" /></span>Practitioners</button>
        <button className="tab" role="tab" id="t-kids" aria-controls="p-kids" aria-selected="false" tabIndex="-1"><span className="ic"><Ic n="baby" /></span>Children</button>
        <button className="tab" role="tab" id="t-rec" aria-controls="p-rec" aria-selected="false" tabIndex="-1"><span className="ic"><Ic n="folder-open" /></span>Child records</button>
        <button className="tab" role="tab" id="t-ctl" aria-controls="p-ctl" aria-selected="false" tabIndex="-1"><span className="ic"><Ic n="sliders-horizontal" /></span>Control</button>
      </div>

      {/* Practitioners */}
      <div className="panel" role="tabpanel" id="p-staff" aria-labelledby="t-staff">
        <div>
          <h3>Your whole staff. One list.</h3>
          <ul className="caps">
            <li><span className="ic"><Ic n="mail-plus" /></span>Invite by email</li>
            <li><span className="ic"><Ic n="file-spreadsheet" /></span>Bulk import a roster</li>
            <li><span className="ic"><Ic n="user-cog" /></span>Assign roles</li>
            <li><span className="ic"><Ic n="user-x" /></span>Deactivate in one click</li>
          </ul>
        </div>
        <div className="stage">
          <span className="tag">Example data</span>
          <div className="stage-title">Staff directory</div>
          <div id="roster">
            <div className="prow"><span className="av">PR</span><div><b>Priya Raman</b><small>Speech</small></div><span className="load">14<em>kids</em></span><span className="pill">Active</span></div>
            <div className="prow" id="rowGone"><span className="av">MB</span><div><b>Marcus Bell</b><small>Physical therapy</small></div><span className="load"><span id="goneLoad">11</span><em>kids</em></span><span className="pill" id="gonePill">Active</span></div>
            <div className="prow"><span className="av">EO</span><div><b>Elena Ortiz</b><small>Occupational therapy</small></div><span className="load">9<em>kids</em></span><span className="pill">Active</span></div>
            <div className="prow" id="rowNew"><span className="av">HC</span><div><b>Hannah Cho</b><small>Special instruction</small></div><span className="load">0<em>kids</em></span><span className="pill inv" id="newPill">Invite sent</span></div>
          </div>
          <div className="toast" id="staffToast"><Ic n="check" /><span>Caseload cleared. Access ended instantly.</span></div>
        </div>
      </div>

      {/* Children */}
      <div className="panel" role="tabpanel" id="p-kids" aria-labelledby="t-kids" hidden>
        <div>
          <h3>Every child. Every provider.</h3>
          <ul className="caps">
            <li><span className="ic"><Ic n="list" /></span>Full agency roster</li>
            <li><span className="ic"><Ic n="users-round" /></span>Multi-provider care teams</li>
            <li><span className="ic"><Ic n="badge" /></span>Discipline on every chip</li>
            <li><span className="ic"><Ic n="repeat" /></span>Reassign in seconds</li>
          </ul>
        </div>
        <div className="stage">
          <span className="tag">Example data</span>
          <div className="stage-title">All children</div>
          <div className="kid">
            <div className="kid-top"><span className="av">LM</span><div><b>Leo M.</b><small>22 months · Bergen County</small></div></div>
            <div className="team2" id="team2">
              <span className="tm">Priya Raman <i>Speech</i></span>
              <span className="tm">Elena Ortiz <i>OT</i></span>
              <span className="tm new" id="tmNew">Hannah Cho <i>Special instruction</i></span>
            </div>
          </div>
          <div className="kids">
            <div>Ava R.<span>3 providers</span></div>
            <div>Noah K.<span>2 providers</span></div>
            <div>Mila S.<span>1 provider</span></div>
          </div>
        </div>
      </div>

      {/* Child records */}
      <div className="panel" role="tabpanel" id="p-rec" aria-labelledby="t-rec" hidden>
        <div>
          <h3>A child's complete record. On demand.</h3>
          <ul className="caps">
            <li><span className="ic"><Ic n="download" /></span>Full record export</li>
            <li><span className="ic"><Ic n="file-pen-line" /></span>Parent correction requests</li>
            <li><span className="ic"><Ic n="file-signature" /></span>Consent before disclosure</li>
            <li><span className="ic"><Ic n="history" /></span>Every change audited</li>
          </ul>
        </div>
        <div className="stage">
          <span className="tag">Example data</span>
          <div className="stage-title">Record for Leo M.</div>
          <div className="rec" id="rec">
            <div><span className="ic"><Ic n="notebook-pen" /></span>Session notes<span className="mono">48</span></div>
            <div><span className="ic"><Ic n="pen-line" /></span>Parent signatures<span className="mono">48</span></div>
            <div><span className="ic"><Ic n="clipboard-list" /></span>IFSP services<span className="mono">3</span></div>
            <div><span className="ic"><Ic n="file-check-2" /></span>Consents on file<span className="mono">2</span></div>
            <div><span className="ic"><Ic n="message-square-check" /></span>Correction requests<span className="mono">1 resolved</span></div>
          </div>
          <div className="export" id="export"><Ic n="file-down" />Full record ready<small>PDF</small></div>
        </div>
      </div>

      {/* Control */}
      <div className="panel" role="tabpanel" id="p-ctl" aria-labelledby="t-ctl" hidden>
        <div>
          <h3>You decide who sees what.</h3>
          <ul className="caps">
            <li><span className="ic"><Ic n="key-round" /></span>Custom roles</li>
            <li><span className="ic"><Ic n="toggle-right" /></span>Fine-grained permissions</li>
            <li><span className="ic"><Ic n="scroll-text" /></span>Full audit log</li>
            <li><span className="ic"><Ic n="message-circle" /></span>Message any practitioner</li>
          </ul>
        </div>
        <div className="stage">
          <div className="stage-title">Roles and permissions</div>
          <div className="role">
            <div className="role-head"><b>Billing specialist</b><span className="pill">Custom role</span></div>
            <div className="perm">Pending bills<span className="sw" data-on="1"></span></div>
            <div className="perm">Invoices<span className="sw" data-on="1"></span></div>
            <div className="perm">Staff directory<span className="sw" data-on="0"></span></div>
            <div className="perm">Child records<span className="sw" data-on="0"></span></div>
            <div className="perm">Audit log<span className="sw" data-on="0"></span></div>
          </div>
          <div className="feed" id="feed">
            <div><Ic n="shield-check" />Role updated by Admin, 2:14 pm</div>
            <div><Ic n="shield-check" />Marcus Bell deactivated, 2:16 pm</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  {/* 4. BENTO */}
  <section className="tone-light section" id="bento" style={{"paddingTop": "0"}}>
    <div className="wrap">
      <div className="sec-head"><h2>Practitioner, caseload <span className="muted">and staff management.</span></h2></div>
      <div className="bento">
        <div className="cell c-a tone-dark" data-watch>
          <span className="tag">Example data</span>
          <h3>Your money, on one screen.</h3>
          <p className="sub">Owed, cleared, and held. Updated as notes move.</p>
          <div className="money">
            <div><span>Owed</span><strong className="mono" data-count="21081" data-prefix="$">$21,081</strong></div>
            <div className="clear"><span>Cleared</span><strong className="mono" data-count="97" data-suffix="%">97%</strong></div>
            <div className="held"><span>Held</span><strong className="mono" data-count="615" data-prefix="$">$615</strong></div>
          </div>
          <div className="split" aria-hidden="true"><i className="a"></i><i className="b"></i></div>
        </div>

        <div className="cell c-b tone-dark" data-watch>
          <h3>Matched to EIMS.</h3>
          <div className="ring">
            <svg viewBox="0 0 160 160" aria-hidden="true"><circle className="track" cx="80" cy="80" r="70"></circle><circle className="bar" cx="80" cy="80" r="70"></circle></svg>
            <div className="ring-center"><div><strong className="mono">11/11</strong><span>fields per note</span></div></div>
          </div>
        </div>

        <div className="cell c-c tone-light-card" data-watch>
          <h3>Only flagged notes need you.</h3>
          <div className="dots" id="dots" aria-label="100 session notes, the flagged ones highlighted"></div>
        </div>

        <div className="cell c-d tone-light-card">
          <span className="tag">Example data</span>
          <h3>See who logs clean.</h3>
          <div className="acc">
            <div>Priya Raman<strong className="hi">100%</strong></div>
            <div>Elena Ortiz<strong className="hi">96%</strong></div>
            <div>Marcus Bell<strong className="lo">82%</strong></div>
          </div>
        </div>

        <div className="cell c-e tone-dark">
          <h3>Log from any phone.</h3>
          <p className="sub">No app store. No IT ticket.</p>
          <div className="phone real" id="phoneReal" role="button" tabIndex="0" aria-haspopup="dialog" aria-label="Try it: log a session in the practitioner app"><div className="screen" role="img" aria-label="Izaya EIS practitioner app home screen: sessions and hours this month, amount ready to invoice, monthly trend, recent children, and the Log a Session button">
            <div className="ps" aria-hidden="true">
              <div className="ps-top"><span className="ps-agency">LITTLE OAKS THERAPY</span><span className="ps-hi">Welcome back,</span><b className="ps-name">Maya Chen</b></div>
              <div className="ps-stats">
                <div><b>42</b><span>Sessions this month</span></div>
                <div><b>31h 30m</b><span>Hours this month</span></div>
                <div><b>$2,835</b><span>Invoiced</span></div>
              </div>
              <div className="ps-ready"><Ic n="file-text" /><div><b>$1,260 ready to invoice</b><span>Notes logged, SEVF not generated yet</span></div><Ic n="chevron-right" /></div>
              <div className="ps-card">
                <div className="ps-row"><span className="ps-label">Monthly trend</span><span className="ps-seg"><em>$ Invoiced</em><span>Hours</span></span></div>
                <div className="ps-bars">
                  <div style={{"--h": ".52"}}><small>$1.9k</small><i></i><span>May</span></div>
                  <div style={{"--h": ".61"}}><small>$2.2k</small><i></i><span>Jun</span></div>
                  <div style={{"--h": ".46"}}><small>$1.6k</small><i></i><span>Jul</span></div>
                  <div style={{"--h": ".70"}}><small>$2.4k</small><i></i><span>Aug</span></div>
                  <div style={{"--h": ".74"}}><small>$2.6k</small><i></i><span>Sep</span></div>
                  <div className="now" style={{"--h": ".84"}}><small>$2.8k</small><i></i><span>Oct</span></div>
                </div>
              </div>
              <span className="ps-label ps-pad">Jump back in</span>
              <div className="ps-chips"><span>Leo R.</span><span>Ava T.</span><span>Noah K.</span><span>Mia S.</span></div>
              <div className="ps-cta"><Ic n="clipboard-pen-line" />Log a Session</div>
              <div className="ps-nav"><span className="on"><Ic n="house" />Home</span><span><Ic n="users" />Children</span><span><Ic n="inbox" />Inbox</span><span><Ic n="credit-card" />Billing</span><span><Ic n="user" />Profile</span></div>
            </div>
          </div></div>
          <button type="button" className="tap" id="simOpen" aria-haspopup="dialog"><Ic n="pointer" />Try it: log a session</button>
        </div>
      </div>
    </div>
  </section>

  {/* 5. SELF-CHECK */}
  <section className="section tone-light" style={{"paddingTop": "0"}} id="check">
    <div className="wrap calc">
      <h2>How does your agency bill today?</h2>
      <div className="check-q">
        <fieldset data-q="eims"><legend>How do you check session notes against EIMS?</legend>
          <div className="opts"><button type="button" className="opt" data-v="hand">By hand</button><button type="button" className="opt" data-v="sheet">In a spreadsheet</button><button type="button" className="opt" data-v="none">We don't, until the state does</button></div></fieldset>
        <fieldset data-q="sevf"><legend>How are your SEVFs and invoices built?</legend>
          <div className="opts"><button type="button" className="opt" data-v="hand">Typed up each month</button><button type="button" className="opt" data-v="tool">From a template or tool</button><button type="button" className="opt" data-v="service">A billing service does it</button></div></fieldset>
        <fieldset data-q="size"><legend>How many practitioners bill through you?</legend>
          <div className="opts"><button type="button" className="opt" data-v="s">1 to 10</button><button type="button" className="opt" data-v="m">11 to 30</button><button type="button" className="opt" data-v="l">More than 30</button></div></fieldset>
      </div>
      <p className="check-out" id="checkOut" aria-live="polite"><span className="muted">Answer three questions to see where Izaya EIS fits.</span></p>
      <Link className="btn btn-primary" data-book="calculator" to="/book?source=calculator">Book a demo <Ic n="arrow-right" /></Link>
    </div>
  </section>

  {/* 6. MARQUEE */}
  <div className="tone-dark marquee" aria-label="Built for New Jersey Early Intervention: SEVF, EIMS reconciliation, error checks before billing, NJEIS service codes, IFSP services, location codes, parent signatures, records releases">
    <div className="track" aria-hidden="true">
      <span className="lead">Built for NJEIS</span><i></i><span>SEVF</span><i></i><span>EIMS reconciliation</span><i></i><span>Error checks before billing</span><i></i><span>Service codes</span><i></i><span>IFSP services</span><i></i><span>Location codes</span><i></i><span>Parent signatures</span><i></i><span>Records releases</span><i></i>
      <span className="lead dup">Built for NJEIS</span><i className="dup"></i><span className="dup">SEVF</span><i className="dup"></i><span className="dup">EIMS reconciliation</span><i className="dup"></i><span className="dup">Error checks before billing</span><i className="dup"></i><span className="dup">Service codes</span><i className="dup"></i><span className="dup">IFSP services</span><i className="dup"></i><span className="dup">Location codes</span><i className="dup"></i><span className="dup">Parent signatures</span><i className="dup"></i><span className="dup">Records releases</span><i className="dup"></i>
    </div>
  </div>

  {/* 7. TRUST */}
  <section className="tone-light section" id="trust">
    <div className="wrap">
      <div className="sec-head"><h2>Consent, records and access controls <span className="muted">for Part C.</span></h2></div>
      <div className="trust-grid">
        <div className="trust-item"><span className="ic"><Ic n="lock-keyhole" /></span><b>Caseload-scoped access</b></div>
        <div className="trust-item"><span className="ic"><Ic n="user-x" /></span><b>Instant access revocation</b></div>
        <div className="trust-item"><span className="ic"><Ic n="file-signature" /></span><b>Consent-gated disclosures</b></div>
        <div className="trust-item"><span className="ic"><Ic n="scroll-text" /></span><b>Audit trail of record views and changes</b></div>
        <div className="trust-item"><span className="ic"><Ic n="shield-check" /></span><b>Encrypted sensitive fields</b></div>
      </div>
    </div>
  </section>

  {/* 8. PILOT */}
  <section className="tone-dark pilot" id="pilot">
    <div className="wrap">
      <h2>30 days free.<br /><span className="accent">Your real session notes.</span></h2>
      <div>
        <ul>
          <li><span className="ic"><Ic n="check" /></span>We set up your agency</li>
          <li><span className="ic"><Ic n="check" /></span>Your team logs real sessions</li>
          <li><span className="ic"><Ic n="check" /></span>Keep it or walk away</li>
        </ul>
        <Link className="btn btn-primary" data-book="pilot" to="/book?source=pilot">Start free pilot <Ic n="arrow-right" /></Link>
      </div>
    </div>
  </section>

  {/* 9. FAQ */}
  <section className="tone-light section" id="faq">
    <div className="wrap faq">
      <h2>Early intervention billing FAQ</h2>
      <details><summary>How do I reconcile service logs with EIMS?<span className="ic"><Ic n="plus" /></span></summary><p>Upload your monthly EIMS service log export. Izaya EIS compares 11 fields on every session note (child ID, child name, practitioner, service date, start and end time, service, location, group size, service status and IFSP event ID) and holds any note that doesn't match until it's fixed or approved.</p></details>
      <details><summary>What is an SEVF, and can it be generated automatically?<span className="ic"><Ic n="plus" /></span></summary><p>The SEVF is the NJEIS form an agency submits for a practitioner's sessions. When every session in a practitioner's batch is clean, Izaya EIS generates the SEVF and the invoice automatically. Batches with flagged notes wait for a person to review them.</p></details>
      <details><summary>How do we stop billing errors from reaching the state?<span className="ic"><Ic n="plus" /></span></summary><p>Every session note is compared with EIMS before billing. Mismatches, sessions missing from EIMS and duplicate entries are flagged and held, so they're corrected before the SEVF goes out instead of being found in a later review.</p></details>
      <details><summary>Is this early intervention software only for billing?<span className="ic"><Ic n="plus" /></span></summary><p>No. You also manage practitioners and their caseloads, every child and their care team, child records, consents and records releases, office staff roles and permissions, and an audit trail, all in the same platform.</p></details>
      <details><summary>How long does setup take for an early intervention agency?<span className="ic"><Ic n="plus" /></span></summary><p>We set up your agency and add your practitioners and children for you during the pilot. Your team walks through it with us on a call.</p></details>
      <details><summary>Do practitioners need training to log sessions?<span className="ic"><Ic n="plus" /></span></summary><p>Very little. They open the app from a link on any phone. A session note is a short form with the child, service, times, location and the parent's signature.</p></details>
      <details><summary>How is child and family information protected?<span className="ic"><Ic n="plus" /></span></summary><p>Each practitioner only sees their own caseload, and access ends as soon as someone is deactivated. Records are shared only with recorded parental consent, sensitive fields are encrypted, and there is an audit trail of who viewed and changed records.</p></details>
      <details><summary>What does it cost?<span className="ic"><Ic n="plus" /></span></summary><p>Pricing depends on your agency's size. We share it on the demo, and the 30-day pilot is free.</p></details>
      <details><summary>What happens after the pilot?<span className="ic"><Ic n="plus" /></span></summary><p>You decide. Keep going on a paid plan, or stop. There is nothing to cancel.</p></details>
    </div>
  </section>

  {/* FINAL CTA */}
  <section className="tone-dark final">
    <div className="wrap">
      <h2>See it run on <span className="accent">your own session notes.</span></h2>
      <div className="cta-row">
        <Link className="btn btn-primary" data-book="final" to="/book?source=final">Book a demo <Ic n="arrow-right" /></Link>
        <Link className="btn btn-ghost" data-book="pilot" to="/book?source=pilot">Start free pilot</Link>
      </div>
    </div>
  </section>
<div className="sim" id="sim" hidden role="dialog" aria-modal="true" aria-labelledby="simTitle">
  <div className="sim-backdrop" data-sim-close></div>
  <div className="sim-stage">
    <aside className="sim-guide">
      <span className="sim-kicker">Try the practitioner app</span>
      <h2 id="simTitle">Log a session like your team does.</h2>
      <ol className="sim-steps" id="simSteps">
        <li data-step="home">Tap <b>Log a Session</b></li>
        <li data-step="roster">Pick a child</li>
        <li data-step="form">Fill in the visit, codes and notes</li>
        <li data-step="sign">Both signatures</li>
        <li data-step="saved"><b>Save Session</b></li>
      </ol>
      <button type="button" className="sim-fill" id="simFill"><Ic n="wand-sparkles" />Fill it in for me</button>
      <p className="sim-small">A simulation with made-up children. Nothing is saved.</p>
    </aside>

    <div className="sim-device">
      <button type="button" className="sim-close" data-sim-close aria-label="Close the demo"><Ic n="x" /></button>
      <div className="sim-phone" id="simPhone">
        <div className="sim-screen" id="simScreen">

          {/* HOME */}
          <section className="sv" data-view="home">
            <div className="sv-scroll">
              <div className="ps-top"><span className="ps-agency">LITTLE OAKS THERAPY</span><span className="ps-hi">Welcome back,</span><b className="ps-name">Maya Chen</b></div>
              <div className="ps-stats">
                <div><b>42</b><span>Sessions this month</span></div>
                <div><b>31h 30m</b><span>Hours this month</span></div>
                <div><b>$2,835</b><span>Invoiced</span></div>
              </div>
              <div className="ps-ready"><Ic n="file-text" /><div><b>$1,260 ready to invoice</b><span>Notes logged, SEVF not generated yet</span></div><Ic n="chevron-right" /></div>
              <span className="ps-label">Jump back in</span>
              <div className="ps-chips"><span>Leo R.</span><span>Ava T.</span><span>Noah K.</span><span>Mia S.</span></div>
              <span className="ps-label">Your schedule</span>
              <div className="sm-card sm-center">No scheduled appointments</div>
            </div>
            <div className="sm-dock">
              <button type="button" className="sm-primary sm-pulse" data-go="roster"><Ic n="clipboard-pen-line" />Log a Session</button>
              <nav className="ps-nav" aria-label="App navigation (demo)"><span className="on"><Ic n="house" />Home</span><span><Ic n="users" />Children</span><span><Ic n="inbox" />Inbox</span><span><Ic n="credit-card" />Billing</span><span><Ic n="user" />Profile</span></nav>
            </div>
          </section>

          {/* ROSTER */}
          <section className="sv" data-view="roster" hidden>
            <div className="sv-scroll">
              <h3 className="sm-h1">Children</h3>
              <div className="sm-intent"><Ic n="clipboard-list" />Select a child below to log a session</div>
              <label className="sm-search"><Ic n="search" /><input type="search" placeholder="Search by name or Child ID" aria-label="Search children" id="simSearch" /></label>
              <div className="sm-list" id="simKids"></div>
            </div>
          </section>

          {/* LOG SESSION FORM */}
          <section className="sv" data-view="form" hidden>
            <div className="sm-bar"><button type="button" className="sm-back" data-go="roster" aria-label="Back"><Ic n="chevron-left" /></button><b>Log Session</b></div>
            <div className="sv-scroll" id="simFormScroll">
              <div className="sm-for"><span>Logging session for</span><b id="simKidName">Leo Rivera</b></div>
              <label className="sm-tele"><input type="checkbox" id="fTele" /><span><b><Ic n="video" />Telepractice (Video) Session</b><small>We'll email the parent a link to review and sign remotely instead of collecting their signature here.</small></span></label>
              <div className="sm-chipsbar" id="simChips"><button type="button" data-sec="details" className="on">Details</button><button type="button" data-sec="codes">Codes</button><button type="button" data-sec="notes">Notes</button><button type="button" data-sec="signatures">Signatures</button></div>

              <div className="sm-sec" data-sec-id="details">
                <h4>Visit details</h4>
                <label className="sm-field"><span>Service date</span><input type="date" id="fDate" /></label>
                <div className="sm-2">
                  <label className="sm-field"><span>Start time</span><input type="time" id="fStart" /><em className="sm-err" data-err="start">Required.</em></label>
                  <label className="sm-field"><span>End time</span><input type="time" id="fEnd" /><em className="sm-err" data-err="end">Required.</em></label>
                </div>
                <div className="sm-quick" id="simQuick"><button type="button" data-q="now">Start now</button><button type="button" data-q="15">15 min</button><button type="button" data-q="30">30 min</button><button type="button" data-q="45">45 min</button><button type="button" data-q="60">60 min</button></div>
                <label className="sm-check"><input type="checkbox" id="fZero" />Session was cancelled, log with 0 time</label>
                <div className="sm-total"><span>Total time</span><b id="fTotal" aria-live="polite">—</b></div>
              </div>

              <div className="sm-sec" data-sec-id="codes">
                <h4>Service codes</h4>
                <label className="sm-field"><span>Service type</span>
                  <select id="fType"><option value="">Select…</option><option>Developmental Intervention</option><option>Speech Language Therapy</option><option>Occupational Therapy</option><option>Physical Therapy</option><option>Social Work</option><option>Family Training</option></select>
                  <em className="sm-err" data-err="type">Service type is required.</em></label>
                <div className="sm-field"><span>Status</span><div className="sm-opts" data-pick="status"><button type="button">Direct Child Service</button><button type="button">Make Up Direct Child Service</button><button type="button">Practitioner Cancelled</button><button type="button">Family Cancelled</button><button type="button">Family Missed</button></div><em className="sm-err" data-err="status">Status is required.</em></div>
                <div className="sm-field"><span>Location</span><div className="sm-opts" data-pick="location"><button type="button">Home</button><button type="button">EC Program - Inclusive Community</button><button type="button">Service Provider Clinic/Office</button><button type="button">Phone/Video Conferencing</button></div><em className="sm-err" data-err="location">Location is required.</em></div>
                <div className="sm-field"><span>Group size category</span><div className="sm-opts" data-pick="group"><button type="button">Direct Child Service - Individual</button><button type="button">Consultation/Facilitation with Others</button></div></div>
              </div>

              <div className="sm-sec" data-sec-id="notes">
                <h4>Session notes</h4>
                <label className="sm-field"><span>Session notes <i className="sm-opt">Optional</i></span><textarea id="fNote" rows="3" placeholder="Add any context on this session..."></textarea></label>
              </div>

              <div className="sm-sec" data-sec-id="signatures">
                <h4>Signatures</h4>
                <div className="sm-field" id="parentSigWrap"><span>Parent/caregiver signature</span>
                  <div className="sm-pad"><canvas id="sigParent" aria-label="Parent signature pad: draw with your finger or mouse"></canvas><small>Parent or caregiver signature, draw with your finger or stylus</small><button type="button" className="sm-clear" data-clear="sigParent">Clear</button></div>
                  <em className="sm-err" data-err="parent">Parent signature is required.</em></div>
                <div className="sm-field" id="teleNote" hidden><span>Parent/caregiver signature</span><div className="sm-card">We'll send a signing link to <b id="simParentEmail">leo.parent@example.com</b> after you submit.</div></div>
                <div className="sm-field"><span>Practitioner signature</span>
                  <div className="sm-pad"><canvas id="sigPrac" aria-label="Practitioner signature pad: draw with your finger or mouse"></canvas><small>Practitioner signature, draw with your finger or stylus</small><button type="button" className="sm-clear" data-clear="sigPrac">Clear</button></div>
                  <button type="button" className="sm-link" id="useSaved">Use saved signature</button>
                  <em className="sm-err" data-err="prac">Practitioner signature is required.</em></div>
              </div>
            </div>
            <div className="sm-submit">
              <p id="simMissing">8 fields still missing</p>
              <div className="sm-split"><button type="button" className="sm-primary" id="simSave">Save Session</button><button type="button" className="sm-primary sm-more" aria-label="More options: Save Draft or Cancel (demo)"><Ic n="chevron-down" /></button></div>
            </div>
          </section>

          {/* CHILD (after save) */}
          <section className="sv" data-view="child" hidden>
            <div className="sm-bar"><button type="button" className="sm-back" data-go="home" aria-label="Back to home"><Ic n="chevron-left" /></button><b id="simChildBar">Leo Rivera</b></div>
            <div className="sv-scroll">
              <div className="sm-kid"><span className="sm-av" id="simChildAv">LR</span><div><b id="simChildName">Leo Rivera</b><small id="simChildId">Child ID 7110000142</small></div></div>
              <span className="ps-label">Recent sessions</span>
              <div className="sm-session sm-new" id="simNewSession"></div>
              <div className="sm-session"><b>Oct 15 · 10:00–10:45 AM</b><span>Developmental Intervention · Home</span><em className="sm-chip">Billed</em></div>
              <div className="sm-session"><b>Oct 8 · 10:00–10:45 AM</b><span>Developmental Intervention · Home</span><em className="sm-chip">Billed</em></div>
              <div className="sm-next">
                <b><Ic n="sparkles" />What happens next</b>
                <p>When your office runs billing, this note is compared with your EIMS export on 11 fields. A clean note goes straight onto the SEVF and invoice. One that doesn't match is held for review.</p>
                <div className="sm-next-actions"><Link className="btn btn-primary btn-sm" data-book="simulator" to="/book?source=simulator">Book a demo</Link><button type="button" className="btn btn-ghost btn-sm" id="simAgain">Log another</button></div>
              </div>
            </div>
          </section>

          <div className="sm-toast" id="simToast" role="status" aria-live="polite"></div>
          <div className="sm-dialog" id="simTeleDone" hidden><div><b>Sent to the parent to sign</b><p>We emailed <span id="simTeleEmail">the parent</span> a link to review and sign. The session is logged once they sign.</p><button type="button" className="sm-primary" id="simTeleOk">OK</button></div></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div className="mbar" id="mbar"><Link className="btn btn-primary" data-book="mobile-bar" to="/book?source=mobile-bar">Book a demo</Link></div>
      </div>
    </MarketingLayout>
  );
}

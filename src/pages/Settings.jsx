// ─── Settings ─────────────────────────────────────────────────────────────────
// The shell only: the nav tree, the search, URL syncing and the layout. Every
// section lives in ./settings/<Section>.jsx.
//
// This file used to be 3,191 lines holding twelve sections and ~25 cards, which
// is why the grouping drifted — "General" was named for its theme picker but
// opened with push notifications, quote wording sat a level away from the quote
// page it writes to, and the AI knowledge base was filed next to force-push.
// Sections are now grouped by the question someone is asking, and two of the
// old sections ("Price Library", "Imports") turned out to be link cards with no
// settings in them at all, so they are links in the sidebar instead.
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings2, Sun, Bell, FileText, Type, MessageSquare, Tag, ClipboardList,
  Calculator, Zap, Database, Bot, Library, Upload, ArrowRight, Search, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

import Appearance from './settings/Appearance';
import Notifications from './settings/Notifications';
import QuotePage from './settings/QuotePage';
import QuoteWording from './settings/QuoteWording';
import MessageTemplates from './settings/MessageTemplates';
import ProductTypes from './settings/ProductTypes';
import MeasureSheet from './settings/MeasureSheet';
import CurtainRates from './settings/CurtainRates';
import Integrations from './settings/Integrations';
import SyncDiagnostics from './settings/SyncDiagnostics';
import AIKnowledge from './settings/AIKnowledge';
import { searchSettings } from './settings/searchIndex';

// ── The nav tree ─────────────────────────────────────────────────────────────
// Grouped by what you came here to change, and labelled for what the section
// actually contains. `links` are destinations elsewhere in the app that belong
// to the group conceptually but are pages, not settings — loading a supplier
// price list is a job, and the priced-items library is a screen of its own.
const NAV_GROUPS = [
  { label: 'This device', items: [
    { id: 'appearance',    label: 'Appearance',    icon: Sun,  desc: 'Theme, colours & background' },
    { id: 'notifications', label: 'Notifications', icon: Bell, desc: 'Push alerts & what you get' },
  ] },
  { label: 'Customer-facing', items: [
    { id: 'quote-page', label: 'Quote page',        icon: FileText,      desc: 'Business, payment & reviews' },
    { id: 'wording',    label: 'Quote wording',     icon: Type,          desc: 'How specs read to customers' },
    { id: 'messages',   label: 'Message templates', icon: MessageSquare, desc: 'Email, SMS & auto-reply' },
  ] },
  { label: 'Measure & pricing', items: [
    { id: 'products', label: 'Product types', icon: Tag,           desc: 'Types, specs & options' },
    { id: 'measure',  label: 'Measure sheet', icon: ClipboardList, desc: 'Dropdown additions' },
    { id: 'curtains', label: 'Curtain rates', icon: Calculator,    desc: 'Costing rate card' },
  ], links: [
    { label: 'Price library', desc: 'Reusable priced items', icon: Library, to: '/priced-items' },
  ] },
  { label: 'Data & integrations', items: [
    { id: 'integrations', label: 'Integrations', icon: Zap, desc: 'Xero & BUZ export' },
  ], links: [
    { label: 'Import data', desc: 'Price lists, contacts & more', icon: Upload, to: '/imports' },
  ] },
  { label: 'Advanced', items: [
    { id: 'sync', label: 'Sync & diagnostics', icon: Database, desc: 'Cloud status & repair' },
    { id: 'ai',   label: 'AI knowledge base',  icon: Bot,      desc: 'Docs the assistant reads' },
  ] },
];

const NAV = NAV_GROUPS.flatMap(g => g.items);
const NAV_INDEX = Object.fromEntries(NAV.map(n => [n.id, n]));

// ── Old ?section= values ─────────────────────────────────────────────────────
// Three pages link into this one (ImportTrackPrices, ImportHub,
// lib/curtainBlockers) and people bookmark sections, so every id the page has
// ever answered to still has to resolve. `pricing` and `imports` were the two
// signpost sections; they now redirect to the pages they only ever pointed at.
const SECTION_ALIASES = {
  general:  'appearance',
  quote:    'quote-page',
  advanced: 'sync',
  exports:  'integrations',
  product:  'products',
};
const SECTION_REDIRECTS = {
  pricing: '/priced-items',
  imports: '/imports',
};

const DEFAULT_SECTION = 'appearance';

const resolveSection = (want) => {
  if (!want) return null;
  if (NAV_INDEX[want]) return want;
  return SECTION_ALIASES[want] || null;
};

export default function Settings() {
  useDataRefresh();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAM } = useProfile() ?? {};
  const isCloud = Boolean(supabase);

  const urlSection = searchParams.get('section');
  const section = resolveSection(urlSection) || DEFAULT_SECTION;
  const current = NAV_INDEX[section];

  // ── Search ──
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState(null);   // card id to highlight after a jump
  const searchRef = useRef(null);
  const results = useMemo(() => searchSettings(query, NAV_INDEX), [query]);

  // ── Mobile drill-down ──
  // A grouped list that opens into a section, rather than a dozen identical
  // pills in a scroller where the active one could end up off screen. Starts on
  // the list unless a ?section= brought you straight to a section.
  const [mobileOpen, setMobileOpen] = useState(() => Boolean(resolveSection(urlSection)));

  // Two of the old ids were signposts. Honour them as redirects so an old link
  // still lands somewhere useful rather than on a section that no longer exists.
  useEffect(() => {
    const to = SECTION_REDIRECTS[urlSection];
    if (to) navigate(to, { replace: true });
  }, [urlSection, navigate]);

  // The section lives in the URL, so back/forward moves between sections and a
  // section can be linked or bookmarked. It used to be useState seeded from
  // ?section= once, which meant the URL went stale the moment you clicked and
  // Back left the page entirely.
  const goto = (id, { card = null, replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    setSearchParams(next, { replace });
    setMobileOpen(true);
    if (card) setFlash(card);
  };

  // Normalise an alias or a missing param into the real id, without adding a
  // history entry — landing on /settings should leave Back pointing at wherever
  // you came from.
  useEffect(() => {
    if (SECTION_REDIRECTS[urlSection]) return;
    if (urlSection !== section) {
      const next = new URLSearchParams(searchParams);
      next.set('section', section);
      setSearchParams(next, { replace: true });
    }
  }, [urlSection, section, searchParams, setSearchParams]);

  // Scroll a searched-for card into view once its section has rendered, and
  // flash it — a jump that lands silently halfway down a long section looks
  // like nothing happened.
  useEffect(() => {
    if (!flash) return;
    const scroll = setTimeout(() => {
      const el = document.querySelector('[data-settings-card="' + flash + '"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    const clear = setTimeout(() => setFlash(null), 2200);
    return () => { clearTimeout(scroll); clearTimeout(clear); };
  }, [flash, section]);

  // ── Handle Xero OAuth callback redirects ────────────────────────────────────
  useEffect(() => {
    const xeroParam = searchParams.get('xero');
    const xeroError = searchParams.get('xero_error');
    if (xeroParam === 'connected') {
      toast('Xero connected successfully!');
      // Remove param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('xero');
      window.history.replaceState({}, '', url);
    }
    if (xeroError) {
      toast(`Xero error: ${xeroError}`, 'error');
      const url = new URL(window.location.href);
      url.searchParams.delete('xero_error');
      window.history.replaceState({}, '', url);
    }
  }, []);

  const pickResult = (r) => {
    setQuery('');
    searchRef.current?.blur();
    goto(r.section, { card: r.card });
  };

  const onSearchKey = (e) => {
    if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
    if (e.key === 'Enter' && results.length) { e.preventDefault(); pickResult(results[0]); }
  };

  const canUseXero = isCloud && isAM;

  const body = (() => {
    switch (section) {
      case 'appearance':    return <Appearance />;
      case 'notifications': return <Notifications />;
      case 'quote-page':    return <QuotePage />;
      case 'wording':       return <QuoteWording />;
      case 'messages':      return <MessageTemplates />;
      case 'products':      return <ProductTypes />;
      case 'measure':       return <MeasureSheet />;
      case 'curtains':      return <CurtainRates />;
      case 'integrations':  return <Integrations canUseXero={canUseXero} isCloud={isCloud} />;
      // Both of these need the cloud to do anything at all. An empty panel
      // reads as a bug, so say which condition is missing.
      case 'sync':
        return isCloud ? <SyncDiagnostics /> : (
          <Unavailable
            title="Nothing to sync"
            detail="This device isn't connected to the cloud, so there's no sync to inspect or repair. Data is stored locally only." />
        );
      case 'ai':
        return isCloud ? <AIKnowledge /> : (
          <Unavailable
            title="AI knowledge base unavailable"
            detail="The knowledge base lives in the cloud, and this device has no connection to it." />
        );
      default:              return <Appearance />;
    }
  })();

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings2 size={22} className="text-amber-500" /> Settings
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform configuration and admin controls</p>
      </div>

      {/* ── Search ── */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
          type="search"
          aria-label="Search settings"
          aria-expanded={results.length > 0}
          aria-controls="settings-search-results"
          placeholder="Search settings — try “SMS quote ready”, “ABN”, “BUZ code”…"
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-9 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {query && (
          <button onClick={() => { setQuery(''); searchRef.current?.focus(); }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}

        {query && (
          <div id="settings-search-results" role="listbox" aria-label="Search results"
            className="absolute z-40 left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
            {results.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-400">Nothing matches “{query}”.</p>
            ) : results.map(r => (
              <button key={r.section + '-' + r.card} role="option" aria-selected="false"
                onClick={() => pickResult(r)}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-amber-50/60 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{r.label}</p>
                  <p className="text-[11px] text-slate-400 truncate">{r.sectionLabel}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Mobile: grouped list that drills into a section ── */}
      <div className="sm:hidden mb-4">
        {!mobileOpen ? (
          <div className="space-y-4">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.label}
                </p>
                <Card className="overflow-hidden divide-y divide-slate-100">
                  {group.items.map(({ id, label, icon: Icon, desc }) => (
                    <button key={id} onClick={() => goto(id)}
                      className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-slate-50">
                      <Icon size={16} className="text-amber-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 leading-tight">{label}</p>
                        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
                      </div>
                      <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                    </button>
                  ))}
                  {(group.links || []).map(({ label, desc, icon: Icon, to }) => (
                    <button key={to} onClick={() => navigate(to)}
                      className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-slate-50">
                      <Icon size={16} className="text-slate-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-600 leading-tight">{label}</p>
                        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
                      </div>
                      <ArrowRight size={15} className="text-slate-300 flex-shrink-0" />
                    </button>
                  ))}
                </Card>
              </div>
            ))}
          </div>
        ) : (
          <button onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 min-h-[44px] text-sm font-medium text-slate-600 hover:text-slate-900">
            <ChevronLeft size={16} /> All settings
            <span className="text-slate-300">/</span>
            <span className="text-slate-800">{current?.label}</span>
          </button>
        )}
      </div>

      <div className="flex gap-6 items-start">

        {/* ── Sidebar nav (desktop only) ── */}
        <aside className="hidden sm:flex flex-col gap-4 w-52 flex-shrink-0 sticky top-6">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              {group.items.map(({ id, label, icon: Icon, desc }) => (
                <button
                  key={id}
                  onClick={() => goto(id)}
                  aria-current={section === id ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-left transition-all ${
                    section === id
                      ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <Icon size={15} className={section === id ? 'text-amber-500' : 'text-slate-400'} />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-tight ${section === id ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                    <p className="text-[10px] text-slate-400 truncate">{desc}</p>
                  </div>
                </button>
              ))}
              {/* Pages, not sections — they leave Settings, and say so with an
                  arrow rather than pretending to be a panel you can open. */}
              {(group.links || []).map(({ label, icon: Icon, to }) => (
                <button key={to} onClick={() => navigate(to)}
                  className="flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-left text-slate-500 hover:bg-slate-100 border border-transparent group">
                  <Icon size={15} className="text-slate-400" />
                  <p className="text-sm font-medium leading-tight flex-1 min-w-0 truncate">{label}</p>
                  <ArrowRight size={13} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* ── Content area ── */}
        <div className={`flex-1 min-w-0 space-y-5 ${mobileOpen ? '' : 'hidden sm:block'}`}>
          {/* The section's own title, so a deep-linked desktop view says where
              it landed without having to read the sidebar. */}
          <div className="hidden sm:block">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              {current?.icon ? <current.icon size={17} className="text-amber-500" /> : null}
              {current?.label}
            </h2>
          </div>
          <div className="space-y-5">{body}</div>
        </div>
      </div>

      {/* The flash itself: a brief ring on the card the search sent you to.
          Drawn with `outline`, not box-shadow — every theme styles the card's
          shadow (the glass skin stacks four layers on it), so a shadow ring
          loses the specificity fight and lands invisibly. Nothing styles
          outline, so it reads the same on all eleven palettes. */}
      {flash && (
        <style>{'[data-settings-card="' + flash + '"] { outline: 2px solid rgb(245 158 11 / 0.95); outline-offset: 3px; border-radius: 0.75rem; }'}</style>
      )}
    </div>
  );
}

/** A section that exists but can't do anything right now, and why. */
function Unavailable({ title, detail }) {
  return (
    <Card className="p-8 text-center">
      <Database size={28} className="mx-auto mb-3 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">{detail}</p>
    </Card>
  );
}

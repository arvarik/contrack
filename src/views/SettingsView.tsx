/**
 * SettingsView — Application settings hub.
 *
 * Contains nested routes for the Dedupe Engine, AI Search, List Manager,
 * and Archived Contacts views, plus inline preference cards.
 */
import React, { useState, useEffect } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Settings as SettingsIcon, Thermometer, Zap, Archive, List, Sparkles } from 'lucide-react';
import { DedupeView } from './dedupe';
import { ArchivedContactsView } from './ArchivedContactsView';
import { ListManagerView } from './lists';
import { AISearchView } from './ai-search';
import { ICON_BTN, PAGE_TITLE, CARD, SECTION_HEADING } from '../lib/styles';
import { cn } from '../lib/utils';
import { usePageTitle } from '../hooks/usePageTitle';
import {
  useRecentContactsLimit,
  MIN_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} from '../hooks/useRecentContacts';
import { useDedupeSettings } from '../hooks/useDedupeSettings';

export const SettingsView = () => {
  const [tempUnit, setTempUnit] = useState<'celsius' | 'fahrenheit'>('celsius');
  const location = useLocation();
  const navigate = useNavigate();

  usePageTitle('Settings');
  const { limit: recentLimit, setLimit: setRecentLimit } = useRecentContactsLimit();
  const { preset, setPreset } = useDedupeSettings();

  useEffect(() => {
    const saved = localStorage.getItem('contrack_temp_unit');
    if (saved === 'fahrenheit' || saved === 'celsius') {
      setTempUnit(saved);
    }
  }, []);

  const handleUnitChange = (unit: 'celsius' | 'fahrenheit') => {
    setTempUnit(unit);
    localStorage.setItem('contrack_temp_unit', unit);
    window.dispatchEvent(new Event('contrack_settings_changed'));
  };

  const isDedupe = location.pathname.endsWith('/dedupe');
  const isArchived = location.pathname.endsWith('/archived');
  const isLists = location.pathname.endsWith('/lists');
  const isAISearch = location.pathname.includes('/ai-search');

  const getTitle = () => {
    if (isDedupe) return 'Dedupe Engine';
    if (isAISearch) return 'AI Search';
    if (isArchived) return 'Archived Contacts';
    if (isLists) return 'List Management';
    return 'Settings';
  };

  const getIcon = () => {
    if (isDedupe) return <Zap className="w-6 h-6 text-primary" />;
    if (isAISearch) return <Sparkles className="w-6 h-6 text-primary" />;
    if (isArchived) return <Archive className="w-6 h-6 text-amber-500" />;
    if (isLists) return <List className="w-6 h-6 text-primary" />;
    return <SettingsIcon className="w-6 h-6 text-primary" />;
  };

  const isSubpage = isDedupe || isArchived || isLists || isAISearch;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface text-on-surface">
      <header className="p-6 bg-surface-container-low shrink-0">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => isSubpage ? navigate('/settings') : navigate('/')}
              className={ICON_BTN}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className={cn(PAGE_TITLE, "flex items-center gap-3")}>
                <div className="p-2 bg-primary/10 rounded-xl">
                  {getIcon()}
                </div>
                {getTitle()}
              </h1>
            </div>
          </div>
        </div>
      </header>

      <div className={cn("flex-1", (isDedupe || isLists) ? "overflow-hidden" : "overflow-y-auto")}>
        <Routes>
          <Route path="/" element={
            <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-4">

              {/* Dedupe Engine — clickable nav + inline settings */}
              <div className={CARD}>
                {/* ── Clickable top: navigates to dedupe view ─────────── */}
                <Link
                  to="/settings/dedupe"
                  className="block hover:opacity-80 transition-opacity group cursor-pointer"
                >
                  <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-primary transition-colors")}>
                    <Zap className="w-5 h-5 text-primary" />
                    Dedupe Engine
                  </h3>
                  <p className="text-sm text-on-surface-variant">
                    Find and merge duplicate contacts using AI-powered detection, or manually select contacts to merge.
                  </p>
                </Link>

                {/* ── Visual separator (background shift, no border) ──── */}
                <div className="mt-4 -mx-6 -mb-6 bg-surface-container-low rounded-b-2xl px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">Auto-Merge Sensitivity</h4>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {preset === 'aggressive'
                          ? 'More auto-merges, fewer manual reviews.'
                          : preset === 'conservative'
                            ? 'Only near-certain matches merge automatically.'
                            : 'Balanced — high-confidence matches auto-merge.'}
                      </p>
                    </div>

                    <div className="flex bg-surface-container rounded-full p-1 shadow-inner h-9 ml-4 shrink-0">
                      {(['conservative', 'default', 'aggressive'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPreset(p)}
                          className={cn(
                            "px-3 h-full rounded-full text-xs font-bold transition-all flex items-center justify-center whitespace-nowrap",
                            preset === p
                              ? "bg-surface shadow-sm text-primary"
                              : "text-on-surface-variant hover:text-on-surface"
                          )}
                        >
                          {p === 'aggressive' ? 'Aggressive' : p === 'conservative' ? 'Conservative' : 'Default'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Search */}
              <Link to="/settings/ai-search" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
                <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-primary transition-colors")}>
                  <Sparkles className="w-5 h-5 text-primary" />
                  AI Search
                </h3>
                <p className="text-sm text-on-surface-variant">
                  Automatically research and enrich contact profiles using AI-powered internet search.
                </p>
              </Link>

              {/* List Management */}
              <Link to="/settings/lists" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
                <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-primary transition-colors")}>
                  <List className="w-5 h-5 text-primary" />
                  List Management
                </h3>
                <p className="text-sm text-on-surface-variant">
                  Reorder, rename, and delete your contact lists. Manage which contacts belong to each list.
                </p>
              </Link>

              {/* Display Preferences */}
              <section className={CARD}>
                <h3 className={cn(SECTION_HEADING, "mb-6 flex items-center gap-2")}>
                  <Thermometer className="w-5 h-5 text-primary" />
                  Display Preferences
                </h3>

                {/* Temperature unit */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <h4 className="font-bold">Temperature Unit</h4>
                    <p className="text-sm text-on-surface-variant">Choose how weather is displayed</p>
                  </div>

                  <div className="flex bg-surface-container rounded-full p-1 shadow-inner h-9">
                    <button
                      onClick={() => handleUnitChange('celsius')}
                      className={cn(
                        "w-12 h-full rounded-full text-xs font-bold transition-all flex items-center justify-center",
                        tempUnit === 'celsius' ? "bg-surface shadow-sm text-primary" : "text-on-surface-variant hover:text-on-surface"
                      )}
                    >
                      °C
                    </button>
                    <button
                      onClick={() => handleUnitChange('fahrenheit')}
                      className={cn(
                        "w-12 h-full rounded-full text-xs font-bold transition-all flex items-center justify-center",
                        tempUnit === 'fahrenheit' ? "bg-surface shadow-sm text-primary" : "text-on-surface-variant hover:text-on-surface"
                      )}
                    >
                      °F
                    </button>
                  </div>
                </div>

                {/* Recent contacts count */}
                <div className="flex items-center justify-between pt-3">
                  <div>
                    <h4 className="font-bold">Recent Contacts</h4>
                    <p className="text-sm text-on-surface-variant">
                      Number of recently visited contacts shown at the top of your Network. Set to 0 to hide.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => setRecentLimit(recentLimit - 1)}
                      disabled={recentLimit <= MIN_RECENT_LIMIT}
                      aria-label="Decrease recent contacts"
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center text-base font-bold transition-all",
                        "bg-surface-container hover:bg-surface-container-high",
                        "disabled:opacity-30 disabled:cursor-not-allowed"
                      )}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-extrabold text-on-surface tabular-nums">
                      {recentLimit}
                    </span>
                    <button
                      onClick={() => setRecentLimit(recentLimit + 1)}
                      disabled={recentLimit >= MAX_RECENT_LIMIT}
                      aria-label="Increase recent contacts"
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center text-base font-bold transition-all",
                        "bg-surface-container hover:bg-surface-container-high",
                        "disabled:opacity-30 disabled:cursor-not-allowed"
                      )}
                    >
                      +
                    </button>
                  </div>
                </div>
              </section>

              {/* Archived Contacts */}
              <Link to="/settings/archived" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
                <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-amber-500 transition-colors")}>
                  <Archive className="w-5 h-5 text-amber-500" />
                  Archived Contacts
                </h3>
                <p className="text-sm text-on-surface-variant">
                  View and restore contacts you've archived. Archived contacts are hidden from your Network and Map.
                </p>
              </Link>

            </div>
          } />

          <Route path="/dedupe" element={
            <div className="absolute inset-0 z-50 bg-surface">
              <DedupeView embedded />
            </div>
          } />

          <Route path="/lists" element={
            <div className="h-full overflow-hidden">
              <ListManagerView />
            </div>
          } />

          <Route path="/archived" element={
            <div className="overflow-y-auto h-full">
              <ArchivedContactsView />
            </div>
          } />

          <Route path="/ai-search" element={
            <div className="overflow-y-auto h-full">
              <AISearchView />
            </div>
          } />
        </Routes>
      </div>
    </div>
  );
};

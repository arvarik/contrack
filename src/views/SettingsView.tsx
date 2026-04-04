import React, { useState, useEffect } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Settings as SettingsIcon, Thermometer, Zap, Archive } from 'lucide-react';
import { CleanupView } from './CleanupView';
import { ArchivedContactsView } from './ArchivedContactsView';
import { ICON_BTN, PAGE_TITLE, CARD, SECTION_HEADING } from '../lib/styles';
import { cn } from '../lib/utils';

export const SettingsView = () => {
  const [tempUnit, setTempUnit] = useState<'celsius' | 'fahrenheit'>('celsius');
  const location = useLocation();
  const navigate = useNavigate();

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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface text-on-surface">
      <header className="p-6 bg-surface-container-low shrink-0">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => (isDedupe || isArchived) ? navigate('/settings') : navigate('/')} 
              className={ICON_BTN}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className={cn(PAGE_TITLE, "flex items-center gap-3")}>
                <div className="p-2 bg-primary/10 rounded-xl">
                  {isDedupe ? <Zap className="w-6 h-6 text-primary" /> : isArchived ? <Archive className="w-6 h-6 text-amber-500" /> : <SettingsIcon className="w-6 h-6 text-primary" />}
                </div>
                {isDedupe ? 'Dedupe Engine' : isArchived ? 'Archived Contacts' : 'Settings'}
              </h1>
            </div>
          </div>
        </div>
      </header>

      <div className={cn("flex-1", isDedupe ? "overflow-hidden" : "overflow-y-auto")}>
        <Routes>
          <Route path="/" element={
            <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
              
              {/* Internal Routing Cards */}
              <Link to="/settings/dedupe" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
                <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-primary transition-colors")}>
                  <Zap className="w-5 h-5 text-primary" />
                  Dedupe Engine
                </h3>
                <p className="text-sm text-on-surface-variant">
                  Find and merge duplicate contacts using AI-powered detection, or manually select contacts to merge.
                </p>
              </Link>

              <Link to="/settings/archived" className={cn(CARD, "block hover:bg-surface-container-high transition-colors group cursor-pointer")}>
                <h3 className={cn(SECTION_HEADING, "mb-2 flex items-center gap-2 group-hover:text-amber-500 transition-colors")}>
                  <Archive className="w-5 h-5 text-amber-500" />
                  Archived Contacts
                </h3>
                <p className="text-sm text-on-surface-variant">
                  View and restore contacts you've archived. Archived contacts are hidden from your Network and Map.
                </p>
              </Link>

              {/* Inline Preference Cards */}
              <section className={CARD}>
                <h3 className={cn(SECTION_HEADING, "mb-6 flex items-center gap-2")}>
                  <Thermometer className="w-5 h-5 text-primary" />
                  Display Preferences
                </h3>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold">Temperature Unit</h4>
                    <p className="text-sm text-on-surface-variant">Choose how weather is displayed</p>
                  </div>
                  
                  <div className="flex bg-surface-container rounded-lg p-1">
                    <button
                      onClick={() => handleUnitChange('celsius')}
                      className={cn(
                        "px-4 py-1.5 rounded-md text-sm font-bold transition-all",
                        tempUnit === 'celsius' ? "bg-surface shadow text-primary" : "text-on-surface-variant hover:text-on-surface"
                      )}
                    >
                      °C
                    </button>
                    <button
                      onClick={() => handleUnitChange('fahrenheit')}
                      className={cn(
                        "px-4 py-1.5 rounded-md text-sm font-bold transition-all",
                        tempUnit === 'fahrenheit' ? "bg-surface shadow text-primary" : "text-on-surface-variant hover:text-on-surface"
                      )}
                    >
                      °F
                    </button>
                  </div>
                </div>
              </section>
              
            </div>
          } />
          
          <Route path="/dedupe" element={
            <div className="h-full overflow-hidden">
              <CleanupView embedded={true} />
            </div>
          } />

          <Route path="/archived" element={
            <div className="overflow-y-auto h-full">
              <ArchivedContactsView />
            </div>
          } />
        </Routes>
      </div>
    </div>
  );
};

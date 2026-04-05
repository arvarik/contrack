import React, { useState } from 'react';

export const BirthdayField = ({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (val: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);

  // Normalize stored value to YYYY-MM-DD for the input
  const toInputValue = (v: string | null): string => {
    if (!v) return '';
    // If already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    // Try parsing other formats
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    return '';
  };

  const formatDisplay = (v: string | null): string | null => {
    if (!v) return null;
    try {
      const inputVal = toInputValue(v);
      if (!inputVal) return v;
      // Parse as local date (avoid UTC shift)
      const [year, month, day] = inputVal.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return v; }
  };

  // Upcoming birthday badge (within 30 days)
  const upcomingDays = (() => {
    const inputVal = toInputValue(value);
    if (!inputVal) return null;
    const [, month, day] = inputVal.split('-').map(Number);
    const today = new Date();
    const thisYear = today.getFullYear();
    let bday = new Date(thisYear, month - 1, day);
    if (bday < today) bday = new Date(thisYear + 1, month - 1, day);
    const diff = Math.round((bday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff <= 30 ? diff : null;
  })();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // YYYY-MM-DD
    if (val) {
      onSave(val);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={toInputValue(value)}
        onChange={handleChange}
        onBlur={() => setIsEditing(false)}
        className="text-sm font-medium bg-surface-container-high rounded-lg px-2 py-1 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none w-full"
      />
    );
  }

  const display = formatDisplay(value);

  return (
    <div
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 cursor-text group/bday"
    >
      <span
        className={`text-sm font-medium py-0.5 px-2 -ml-2 rounded transition-colors hover:bg-surface-container-high ${
          display ? 'text-on-surface' : 'text-on-surface-variant opacity-50 italic'
        }`}
      >
        {display || 'Add Birthday...'}
      </span>
      {upcomingDays !== null && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 shrink-0">
          {upcomingDays === 0 ? '🎂 Today!' : `🎂 in ${upcomingDays}d`}
        </span>
      )}
    </div>
  );
};

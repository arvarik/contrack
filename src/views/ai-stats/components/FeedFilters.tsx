/**
 * FeedFilters — Filter pills + sort toggle for the AI Stats activity feed.
 * Follows the filterPill pattern from the AI Search view.
 */
import React from 'react';
import { cn } from '../../../lib/utils';
import { ArrowUpDown } from 'lucide-react';

interface FeedFiltersProps {
  cacheFilter: 'all' | 'fresh' | 'cached';
  onCacheFilterChange: (f: 'all' | 'fresh' | 'cached') => void;
  sort: 'newest' | 'oldest';
  onSortChange: (s: 'newest' | 'oldest') => void;
}

const CACHE_PILLS: { value: 'all' | 'fresh' | 'cached'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'cached', label: 'Cached' },
];

export const FeedFilters = ({ cacheFilter, onCacheFilterChange, sort, onSortChange }: FeedFiltersProps) => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Cache filter pills */}
      <div className="flex bg-surface-container rounded-full p-1 shadow-inner h-8">
        {CACHE_PILLS.map((pill) => (
          <button
            key={pill.value}
            onClick={() => onCacheFilterChange(pill.value)}
            className={cn(
              'px-3 h-full rounded-full text-xs font-bold transition-all flex items-center justify-center whitespace-nowrap',
              cacheFilter === pill.value
                ? 'bg-surface shadow-sm text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Sort toggle */}
      <button
        onClick={() => onSortChange(sort === 'newest' ? 'oldest' : 'newest')}
        className={cn(
          'ml-auto flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-bold',
          'bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors'
        )}
      >
        <ArrowUpDown className="w-3 h-3" />
        {sort === 'newest' ? 'Newest' : 'Oldest'}
      </button>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Activity,
  Filter,
  Search,
  X,
  Download,
  FileSpreadsheet,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { Journey } from '../../domain/types/index.ts';

export type JourneyFilterState = 'ALL' | 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'ACTIVE';

export interface JourneyFilterCounts {
  all?: number;
  upcoming?: number;
  completed?: number;
  cancelled?: number;
  active?: number;
}

export interface JourneyFilterBarProps {
  /** Currently selected filter state */
  selectedFilter: JourneyFilterState;
  /** Callback triggered when user toggles/selects a state filter */
  onFilterChange: (filter: JourneyFilterState) => void;
  /** Optional counts per journey category for badges */
  counts?: JourneyFilterCounts;
  /** Optional list of journeys to compute counts automatically if counts prop is not provided */
  journeys?: Journey[];
  /** Optional search query value */
  searchQuery?: string;
  /** Optional callback when search query input changes */
  onSearchChange?: (query: string) => void;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Total matching journeys count after search & filter */
  filteredCount?: number;
  /** Optional custom class name */
  className?: string;
  /** Whether to show the search bar in the filter bar */
  showSearch?: boolean;
  /** Allow resetting back to 'ALL' */
  onReset?: () => void;
  /** Optional callback to export filtered records as CSV */
  onExportCsv?: () => void;
  /** Optional callback to export filtered records as PDF */
  onExportPdf?: () => void;
  /** Whether export is disabled (e.g. 0 filtered items) */
  isExportDisabled?: boolean;
}

// Helpers for journey status categorization
export const isJourneyUpcoming = (journey: Journey): boolean => {
  return (
    journey.bookingType === 'SCHEDULED' &&
    (journey.currentState === 'DRAFT' ||
      journey.currentState === 'REQUESTED' ||
      journey.currentState === 'MATCHING')
  );
};

export const isJourneyActive = (journey: Journey): boolean => {
  return (
    journey.currentState !== 'COMPLETED' &&
    journey.currentState !== 'CANCELLED' &&
    journey.currentState !== 'PARTNER_CANCELLED' &&
    !isJourneyUpcoming(journey)
  );
};

export const isJourneyCompleted = (journey: Journey): boolean => {
  return journey.currentState === 'COMPLETED';
};

export const isJourneyCancelled = (journey: Journey): boolean => {
  return (
    journey.currentState === 'CANCELLED' ||
    journey.currentState === 'PARTNER_CANCELLED'
  );
};

/**
 * Filter an array of journeys according to a given filter state and optional search query
 */
export const filterJourneysByState = (
  journeys: Journey[],
  filter: JourneyFilterState,
  searchQuery = ''
): Journey[] => {
  return journeys.filter((journey) => {
    // 1. Status Filter
    if (filter === 'UPCOMING' && !isJourneyUpcoming(journey)) return false;
    if (filter === 'ACTIVE' && !isJourneyActive(journey)) return false;
    if (filter === 'COMPLETED' && !isJourneyCompleted(journey)) return false;
    if (filter === 'CANCELLED' && !isJourneyCancelled(journey)) return false;

    // 2. Query Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hospName = journey.hospitalDestination?.name?.toLowerCase() || '';
      const pickupAddr = journey.pickupLocation?.address?.toLowerCase() || '';
      const idMatch = journey.id.toLowerCase().includes(q);
      const stateMatch = journey.currentState.toLowerCase().includes(q);
      const partnerMatch = journey.carePartnerId?.toLowerCase().includes(q) || false;
      return hospName.includes(q) || pickupAddr.includes(q) || idMatch || stateMatch || partnerMatch;
    }

    return true;
  });
};

/**
 * Compute counts for each status category from an array of journeys
 */
export const calculateJourneyCounts = (journeys: Journey[]): JourneyFilterCounts => {
  return {
    all: journeys.length,
    upcoming: journeys.filter(isJourneyUpcoming).length,
    active: journeys.filter(isJourneyActive).length,
    completed: journeys.filter(isJourneyCompleted).length,
    cancelled: journeys.filter(isJourneyCancelled).length,
  };
};

/**
 * Reusable Filter Bar Component for Journey Dashboards
 * Enables users to toggle between 'Upcoming', 'Completed', and 'Cancelled' journey states,
 * and provides export to CSV or PDF for patient records.
 */
export const JourneyFilterBar: React.FC<JourneyFilterBarProps> = ({
  selectedFilter,
  onFilterChange,
  counts,
  journeys,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search hospital, address or ID...',
  filteredCount,
  className = '',
  showSearch = true,
  onReset,
  onExportCsv,
  onExportPdf,
  isExportDisabled = false,
}) => {
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Determine counts either from props or computed from journeys list
  const resolvedCounts: JourneyFilterCounts = React.useMemo(() => {
    if (counts) return counts;
    if (journeys) return calculateJourneyCounts(journeys);
    return {};
  }, [counts, journeys]);

  const filterTabs = [
    {
      id: 'ALL' as JourneyFilterState,
      label: 'All Trips',
      count: resolvedCounts.all,
      icon: Calendar,
      color: 'teal',
    },
    {
      id: 'UPCOMING' as JourneyFilterState,
      label: 'Upcoming',
      count: resolvedCounts.upcoming,
      icon: Clock,
      color: 'blue',
    },
    {
      id: 'COMPLETED' as JourneyFilterState,
      label: 'Completed',
      count: resolvedCounts.completed,
      icon: CheckCircle2,
      color: 'emerald',
    },
    {
      id: 'CANCELLED' as JourneyFilterState,
      label: 'Cancelled',
      count: resolvedCounts.cancelled,
      icon: AlertCircle,
      color: 'slate',
    },
    {
      id: 'ACTIVE' as JourneyFilterState,
      label: 'In Progress',
      count: resolvedCounts.active,
      icon: Activity,
      color: 'amber',
    },
  ];

  const handleClear = () => {
    if (onReset) {
      onReset();
    } else {
      onFilterChange('ALL');
      if (onSearchChange) onSearchChange('');
    }
  };

  const isFiltering = selectedFilter !== 'ALL' || Boolean(searchQuery.trim());
  const activeTabMeta = filterTabs.find((t) => t.id === selectedFilter);

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-4 shadow-2xs space-y-3 ${className}`}
      data-testid="journey-filter-bar"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* State Toggle Buttons */}
        <div
          className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto text-xs font-medium"
          role="tablist"
          aria-label="Filter journeys by status"
        >
          {filterTabs.map((tab) => {
            const isActive = selectedFilter === tab.id;
            const TabIcon = tab.icon;
            const count = tab.count;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onFilterChange(tab.id)}
                className={`px-3 py-2 rounded-lg transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer select-none ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs font-semibold ring-1 ring-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <TabIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isActive
                      ? tab.id === 'UPCOMING'
                        ? 'text-blue-600'
                        : tab.id === 'COMPLETED'
                        ? 'text-emerald-600'
                        : tab.id === 'CANCELLED'
                        ? 'text-slate-600'
                        : tab.id === 'ACTIVE'
                        ? 'text-amber-600'
                        : 'text-teal-600'
                      : 'text-slate-400'
                  }`}
                />
                <span>{tab.label}</span>
                {typeof count === 'number' && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums transition-colors ${
                      isActive
                        ? tab.id === 'UPCOMING'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                          : tab.id === 'COMPLETED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                          : tab.id === 'CANCELLED'
                          ? 'bg-slate-200 text-slate-700 border border-slate-300/60'
                          : tab.id === 'ACTIVE'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                          : 'bg-teal-50 text-teal-700 border border-teal-200/60'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search Input, Clear Button, and Export Dropdown */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {showSearch && onSearchChange && (
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-8 py-2 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  title="Clear search input"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {isFiltering && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              title="Reset all filters and search"
            >
              Reset
            </button>
          )}

          {/* Export Action Menu */}
          {(onExportCsv || onExportPdf) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExportDisabled}
                className={`px-3 py-2 border rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
                  isExportDisabled
                    ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 shadow-2xs'
                }`}
                title="Export filtered journeys records"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showExportMenu && !isExportDisabled && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1.5 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Export Records
                    </div>
                    {onExportCsv && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowExportMenu(false);
                          onExportCsv();
                        }}
                        className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                        <div>
                          <div className="font-semibold">Export as CSV</div>
                          <div className="text-[10px] text-slate-400">Excel / Spreadsheet data</div>
                        </div>
                      </button>
                    )}
                    {onExportPdf && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowExportMenu(false);
                          onExportPdf();
                        }}
                        className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800 flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-100"
                      >
                        <FileText className="w-4 h-4 text-rose-600" />
                        <div>
                          <div className="font-semibold">Export / Print PDF</div>
                          <div className="text-[10px] text-slate-400">Official printable report</div>
                        </div>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active Filter Indicator Badge */}
      {selectedFilter !== 'ALL' && (
        <div className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-slate-50 rounded-lg border border-slate-100 text-slate-600 animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span>
              Filtering by <strong>{activeTabMeta?.label}</strong>
              {typeof filteredCount === 'number' && (
                <span className="text-slate-500 ml-1">
                  ({filteredCount}{typeof resolvedCounts.all === 'number' ? ` of ${resolvedCounts.all}` : ''} journeys)
                </span>
              )}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onFilterChange('ALL')}
            className="text-teal-700 hover:text-teal-900 font-semibold cursor-pointer underline text-[11px]"
          >
            Show all trips
          </button>
        </div>
      )}
    </div>
  );
};

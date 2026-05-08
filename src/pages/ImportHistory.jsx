import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, subDays, subMonths, startOfYear } from 'date-fns';
import {
  History, ArrowLeft, Users, Library, Download, Search,
  ChevronDown, Filter, FileText,
} from 'lucide-react';
import { getImportBatches, getPricedItemBatches } from '../store/data';
import Card from '../components/Card';

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function StatusBadge({ status }) {
  const map = {
    'Completed':             'bg-green-50 text-green-600',
    'Completed with errors': 'bg-yellow-50 text-yellow-600',
    'Failed':                'bg-red-50 text-red-500',
    'Processing':            'bg-blue-50 text-blue-600',
    'Previewed':             'bg-slate-100 text-slate-500',
    'Uploaded':              'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

const DATE_RANGES = [
  { value: 'all',   label: 'All time' },
  { value: '30d',   label: 'Last 30 days' },
  { value: '90d',   label: 'Last 90 days' },
  { value: '6m',    label: 'Last 6 months' },
  { value: 'ytd',   label: 'Year to date' },
];

function getDateRangeStart(value) {
  const now = new Date();
  switch (value) {
    case '30d': return subDays(now, 30);
    case '90d': return subDays(now, 90);
    case '6m':  return subMonths(now, 6);
    case 'ytd': return startOfYear(now);
    default:    return null;
  }
}

export default function ImportHistory() {
  const navigate = useNavigate();

  const [filterType,   setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate,   setFilterDate]   = useState('all');
  const [search,       setSearch]       = useState('');

  const allBatches = useMemo(() => {
    const contacts = (getImportBatches()      || []).map(b => ({ ...b, importType: 'Contacts' }));
    const priced   = (getPricedItemBatches()  || []).map(b => ({ ...b, importType: 'Priced Items' }));
    return [...contacts, ...priced].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, []);

  const filtered = useMemo(() => {
    const rangeStart = getDateRangeStart(filterDate);
    return allBatches.filter(b => {
      if (filterType !== 'all' && b.importType !== filterType) return false;
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (rangeStart) {
        const d = new Date(b.completedAt || b.createdAt);
        if (d < rangeStart) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.fileName?.toLowerCase().includes(q) &&
          !b.uploadedBy?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [allBatches, filterType, filterStatus, filterDate, search]);

  const statuses = [...new Set(allBatches.map(b => b.status).filter(Boolean))];

  const totals = useMemo(() => filtered.reduce((acc, b) => ({
    rows:      acc.rows      + (b.totalRows      || 0),
    imported:  acc.imported  + (b.importedCount  || 0),
    updated:   acc.updated   + (b.updatedCount   || 0),
    dupes:     acc.dupes     + (b.duplicateCount || 0),
    errors:    acc.errors    + (b.errorCount     || 0),
    skipped:   acc.skipped   + (b.skippedCount   || 0),
  }), { rows: 0, imported: 0, updated: 0, dupes: 0, errors: 0, skipped: 0 }), [filtered]);

  const downloadCSV = () => {
    const headers = ['Type', 'File', 'Uploaded By', 'Date', 'Status', 'Total', 'Imported', 'Updated', 'Duplicates', 'Errors', 'Skipped'];
    const rows = filtered.map(b => [
      csvEscape(b.importType),
      csvEscape(b.fileName),
      csvEscape(b.uploadedBy || 'Admin'),
      csvEscape(b.completedAt ? format(parseISO(b.completedAt), 'd MMM yyyy HH:mm') : ''),
      csvEscape(b.status),
      b.totalRows      || 0,
      b.importedCount  || 0,
      b.updatedCount   || 0,
      b.duplicateCount || 0,
      b.errorCount     || 0,
      b.skippedCount   || 0,
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'lusso-import-history.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ArrowLeft size={16}/>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <History size={20} className="text-amber-500"/> Import History
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">All contact and priced item imports in one place.</p>
          </div>
        </div>
        <div className="flex gap-2 self-start">
          <button
            onClick={() => navigate('/import')}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <Users size={14}/> Import Contacts
          </button>
          <button
            onClick={() => navigate('/priced-items?tab=import')}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <Library size={14}/> Import Priced Items
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Total Rows',  value: totals.rows,     color: 'text-slate-700' },
            { label: 'Imported',    value: totals.imported, color: 'text-green-600' },
            { label: 'Updated',     value: totals.updated,  color: 'text-blue-600' },
            { label: 'Duplicates',  value: totals.dupes,    color: 'text-yellow-600' },
            { label: 'Errors',      value: totals.errors,   color: 'text-red-500' },
            { label: 'Skipped',     value: totals.skipped,  color: 'text-slate-400' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="px-4 py-3 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search file name or user…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* Type filter */}
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="all">All Types</option>
          <option value="Contacts">Contacts</option>
          <option value="Priced Items">Priced Items</option>
        </select>

        {/* Date filter */}
        <select
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="all">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="ml-auto">
          <button
            onClick={downloadCSV}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition-colors"
          >
            <Download size={13}/> Export
          </button>
        </div>
      </Card>

      {/* History table */}
      <Card>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <History size={32} className="mx-auto mb-3 opacity-40"/>
            <p className="text-sm font-medium">No imports found.</p>
            <p className="text-xs mt-1">
              {allBatches.length === 0
                ? 'Run your first import from Settings → Imports.'
                : 'Try adjusting the filters above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 font-medium border-b border-slate-100">
                  <th className="px-5 py-2.5 text-left">Type</th>
                  <th className="px-5 py-2.5 text-left">File</th>
                  <th className="px-5 py-2.5 text-left">Uploaded By</th>
                  <th className="px-5 py-2.5 text-left">Date</th>
                  <th className="px-5 py-2.5 text-left">Status</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5 text-right">Imported</th>
                  <th className="px-5 py-2.5 text-right">Updated</th>
                  <th className="px-5 py-2.5 text-right">Dupes</th>
                  <th className="px-5 py-2.5 text-right">Errors</th>
                  <th className="px-5 py-2.5 text-right">Skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                        b.importType === 'Contacts'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {b.importType === 'Contacts' ? <Users size={10}/> : <Library size={10}/>}
                        {b.importType}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-slate-400 flex-shrink-0"/>
                        <span className="text-slate-700 font-medium truncate max-w-[200px]">{b.fileName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{b.uploadedBy || 'Admin'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {b.completedAt
                        ? format(parseISO(b.completedAt), 'd MMM yyyy h:mm a')
                        : b.createdAt
                          ? format(parseISO(b.createdAt), 'd MMM yyyy h:mm a')
                          : '—'}
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={b.status}/></td>
                    <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{b.totalRows      || 0}</td>
                    <td className="px-5 py-3 text-right text-green-600 font-medium tabular-nums">{b.importedCount  || 0}</td>
                    <td className="px-5 py-3 text-right text-blue-600 tabular-nums">{b.updatedCount   || 0}</td>
                    <td className="px-5 py-3 text-right text-yellow-600 tabular-nums">{b.duplicateCount || 0}</td>
                    <td className="px-5 py-3 text-right text-red-500 tabular-nums">{b.errorCount     || 0}</td>
                    <td className="px-5 py-3 text-right text-slate-400 tabular-nums">{b.skippedCount   || 0}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-100 bg-slate-50">
                <tr className="text-xs font-semibold text-slate-600">
                  <td className="px-5 py-2.5" colSpan={5}>Totals ({filtered.length} batch{filtered.length !== 1 ? 'es' : ''})</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{totals.rows}</td>
                  <td className="px-5 py-2.5 text-right text-green-600 tabular-nums">{totals.imported}</td>
                  <td className="px-5 py-2.5 text-right text-blue-600 tabular-nums">{totals.updated}</td>
                  <td className="px-5 py-2.5 text-right text-yellow-600 tabular-nums">{totals.dupes}</td>
                  <td className="px-5 py-2.5 text-right text-red-500 tabular-nums">{totals.errors}</td>
                  <td className="px-5 py-2.5 text-right text-slate-400 tabular-nums">{totals.skipped}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

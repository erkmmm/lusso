import { useState, useEffect, useMemo, useRef } from 'react';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft, Plus, Trash2, Save, Send, CheckCircle2,
  ChevronDown, ChevronUp, User, MapPin, Briefcase,
  ClipboardList, AlertCircle, Edit3, Search, X,
  UserCheck, UserPlus, AlertTriangle, Phone, Mail,
  Copy, Printer,
} from 'lucide-react';
import {
  saveMeasureSheet, getMeasureSheet, findOrCreateCustomer, getCustomer,
  getCustomers, getJobs, createJobFromMeasureSheet, getActiveProductTypes,
  CONTROL_OPTIONS, RETURN_OPTIONS, MOTOR_SIDE_OPTIONS, FIXING_OPTIONS,
  HEADING_OPTIONS, HEM_OPTIONS, TRACK_COLOUR_OPTIONS, OPERATION_TYPE_OPTIONS,
  BASE_BAR_TYPE_OPTIONS, CHAIN_COLOUR_OPTIONS, URGENCY_LEVELS, JOB_TYPES,
} from '../store/data';
import { syncNow } from '../store/db';
import Card from '../components/Card';

// ─── Customer search & duplicate helpers ──────────────────────────────────────

function cleanPhone(p) { return (p || '').replace(/[\s\-\(\)\+]/g, ''); }

function extractSuburb(address) {
  if (!address) return '';
  const states = ['NSW','VIC','QLD','WA','SA','TAS','NT','ACT'];
  const parts = address.split(/[\s,]+/).filter(Boolean);
  const filtered = parts.filter(p => !/^\d{4}$/.test(p) && !states.includes(p.toUpperCase()));
  return (filtered[filtered.length - 1] || '').toLowerCase();
}

function nameSimilarity(a, b) {
  a = (a || '').toLowerCase().trim();
  b = (b || '').toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  // word overlap
  const wa = new Set(a.split(/\s+/));
  const wb = new Set(b.split(/\s+/));
  const shared = [...wa].filter(w => wb.has(w)).length;
  return shared / Math.max(wa.size, wb.size);
}

function searchCustomers(query, customers) {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase().trim();
  const qPhone = cleanPhone(query);
  return customers.filter(c => {
    const fields = [
      c.name, c.company, c.email, c.address, c.suburb,
    ].map(f => (f || '').toLowerCase());
    const phoneFields = [cleanPhone(c.phone), cleanPhone(c.mobile)];
    return fields.some(f => f.includes(q)) ||
      (qPhone.length >= 6 && phoneFields.some(f => f.includes(qPhone)));
  }).slice(0, 8);
}

function findDuplicates(name, phone, email, address, customers) {
  const matches = [];
  const CONFIDENCE = { high: 0, medium: 1, low: 2 };

  for (const c of customers) {
    let confidence = null;
    let reason = null;

    const emailHit  = email && c.email  && email.toLowerCase().trim() === c.email.toLowerCase().trim();
    const phoneHit  = phone && c.phone  && cleanPhone(phone).length >= 8 && cleanPhone(phone) === cleanPhone(c.phone);
    const mobileHit = phone && c.mobile && cleanPhone(phone).length >= 8 && cleanPhone(phone) === cleanPhone(c.mobile);
    const nameSim   = nameSimilarity(name, c.name);

    if (emailHit) {
      confidence = 'high'; reason = 'Same email address';
    } else if (phoneHit || mobileHit) {
      confidence = 'high'; reason = 'Same phone number';
    } else if (nameSim >= 0.9) {
      const sub1 = extractSuburb(address);
      const sub2 = extractSuburb(c.address);
      if (sub1 && sub2 && sub1 === sub2) {
        confidence = 'medium'; reason = 'Same name and suburb';
      } else if (address && c.address && address.toLowerCase().slice(0, 10) === c.address.toLowerCase().slice(0, 10)) {
        confidence = 'medium'; reason = 'Same name and address';
      } else {
        confidence = 'low'; reason = 'Similar name';
      }
    } else if (nameSim >= 0.75) {
      confidence = 'low'; reason = 'Similar name';
    }

    if (confidence) matches.push({ customer: c, confidence, reason });
  }

  return matches.sort((a, b) => CONFIDENCE[a.confidence] - CONFIDENCE[b.confidence]).slice(0, 3);
}

// ─── Module-level sub-components (no focus-loss bug) ─────────────────────────

function CustomerSearchInput({ value, onChange, onEnter, placeholder }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onEnter) onEnter();
  };
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Search by name, phone, email, address…'}
        className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
      />
      {value && (
        <button onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function CustomerResultCard({ customer, jobCount, onSelect }) {
  return (
    <button
      onClick={() => onSelect(customer)}
      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-amber-50 transition-colors border-b border-slate-50 last:border-0"
    >
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-amber-700 font-bold text-xs">{customer.name?.charAt(0) || '?'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-slate-800">{customer.name}</span>
          {customer.company && <span className="text-xs text-slate-400">{customer.company}</span>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-500">
          {customer.phone && <span className="flex items-center gap-1"><Phone size={10} />{customer.phone}</span>}
          {customer.email && <span className="flex items-center gap-1"><Mail size={10} />{customer.email}</span>}
          {customer.address && <span className="flex items-center gap-1 truncate max-w-[200px]"><MapPin size={10} />{customer.address}</span>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        {jobCount > 0 && (
          <span className="text-xs font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
            {jobCount} job{jobCount !== 1 ? 's' : ''}
          </span>
        )}
        <div className="text-xs text-amber-600 font-medium mt-0.5">Select →</div>
      </div>
    </button>
  );
}

function SelectedCustomerCard({ customer, onClear, navigate }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        <UserCheck size={16} className="text-green-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-0.5">Customer Selected</p>
        <p className="font-semibold text-slate-900">{customer.name}</p>
        <div className="flex flex-wrap gap-x-3 mt-0.5 text-xs text-slate-500">
          {customer.phone   && <span>{customer.phone}</span>}
          {customer.email   && <span>{customer.email}</span>}
          {customer.address && <span>{customer.address}</span>}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button onClick={() => navigate(`/customers/${customer.id}`)}
          className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors bg-white">
          View
        </button>
        <button onClick={onClear}
          className="text-xs text-slate-500 hover:text-red-600 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors bg-white">
          Change
        </button>
      </div>
    </div>
  );
}

const CONFIDENCE_STYLE = {
  high:   { bar: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200',   label: 'High match' },
  medium: { bar: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Possible match' },
  low:    { bar: 'bg-slate-400',  badge: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Similar name' },
};

function DuplicateMatchCard({ match, onUse, onViewProfile, navigate }) {
  const { customer, confidence, reason } = match;
  const style = CONFIDENCE_STYLE[confidence];
  return (
    <div className={`border rounded-xl overflow-hidden ${confidence === 'high' ? 'border-red-200' : confidence === 'medium' ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className={`h-1 ${style.bar}`} />
      <div className="p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center flex-shrink-0">
          <span className="text-slate-600 font-bold text-xs">{customer.name?.charAt(0) || '?'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-semibold text-sm text-slate-800">{customer.name}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${style.badge}`}>
              {style.label}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-1">
            <span className="font-medium text-slate-700">{reason}</span>
            {customer.phone && ` · ${customer.phone}`}
            {customer.address && ` · ${customer.address}`}
          </p>
        </div>
      </div>
      <div className="border-t border-slate-100 px-3 py-2 flex gap-2 bg-slate-50/50">
        <button onClick={() => onUse(customer)}
          className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors">
          Use this customer
        </button>
        <button onClick={() => navigate(`/customers/${customer.id}`)}
          className="px-3 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg py-1.5 transition-colors bg-white">
          View
        </button>
      </div>
    </div>
  );
}

// ─── Form primitives ──────────────────────────────────────────────────────────

function FormField({ label, error, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
    </div>
  );
}

function SpecSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Section({ title, icon, open, onToggle, children }) {
  return (
    <Card>
      <button onClick={onToggle}
        className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between text-left">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">{icon}{title}</h2>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </Card>
  );
}

const inputCls = (error) =>
  `w-full border rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 transition-colors ${
    error ? 'border-red-300 focus:ring-red-300 bg-red-50' : 'border-slate-200 focus:ring-amber-400 bg-white'
  }`;

const inp = () => 'w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400';

// ─── Line item defaults ───────────────────────────────────────────────────────

const EMPTY_LINE_ITEM = () => ({
  id: uuidv4(), location: '', productTypeId: '', productNameSnapshot: '',
  quantity: 1, widthMm: '', dropMm: '', fabricColour: '', control: '',
  returnSide: '', motorSide: '', fixing: '', heading: '', attachedLining: false,
  liningFabricColour: '', hem: '', trackBaseBarColour: '', trackType: '',
  baseBarType: '', chainColour: '', notes: '', sortOrder: 0,
});

const EMPTY_SHEET = () => ({
  id: uuidv4(), status: 'Draft', createdAt: new Date().toISOString(),
  customerName: '', phone: '', email: '', siteAddress: '', billingAddress: '',
  preferredContact: 'Any', customerNotes: '',
  jobType: '', measureDate: new Date().toISOString().slice(0, 10),
  measurer: '', urgency: 'Normal', accessInstructions: '', parkingNotes: '',
  siteConditionNotes: '', internalNotes: '',
  lineItems: [EMPTY_LINE_ITEM()],
});

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewMeasureSheet() {
  const { id }           = useParams();
  const [searchParams]   = useSearchParams();
  const navigate         = useNavigate();
  const isEdit           = Boolean(id && id !== 'new');
  // Active salespeople from Supabase — pending/suspended never appear here
  const { salespeople: staff } = useActiveSalespeople();
  const productTypes     = getActiveProductTypes();
  const allCustomers     = useMemo(() => getCustomers(), []);
  const allJobs          = useMemo(() => getJobs(), []);

  // Pre-linking from customer profile
  const prelinkedCustomerId = searchParams.get('customerId') || null;
  const prelinkedCustomer   = prelinkedCustomerId ? getCustomer(prelinkedCustomerId) : null;

  // ── Sheet state ────────────────────────────────────────────────────────────
  const [sheet, setSheet] = useState(() => {
    if (isEdit) return getMeasureSheet(id) || EMPTY_SHEET();
    if (prelinkedCustomer) {
      return {
        ...EMPTY_SHEET(),
        customerId: prelinkedCustomer.id,
        customerName: prelinkedCustomer.name    || '',
        phone:        prelinkedCustomer.phone   || '',
        email:        prelinkedCustomer.email   || '',
        siteAddress:  prelinkedCustomer.address || '',
        billingAddress: prelinkedCustomer.billingAddress || '',
        preferredContact: prelinkedCustomer.preferredContact || 'Any',
        customerNotes: prelinkedCustomer.notes  || '',
      };
    }
    return EMPTY_SHEET();
  });

  // ── Customer selection state ───────────────────────────────────────────────
  // customerMode: 'select' | 'new'
  const [customerMode,    setCustomerMode]    = useState('select');
  const [customerSearch,  setCustomerSearch]  = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(prelinkedCustomer || null);
  const [duplicates,      setDuplicates]      = useState([]);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);


  // ── UI state ───────────────────────────────────────────────────────────────
  const [savedAt,        setSavedAt]        = useState(null);
  const [submitted,      setSubmitted]      = useState(false);
  const [submittedJobId, setSubmittedJobId] = useState(null);
  const [submitting,     setSubmitting]     = useState(false);
  const [errors,         setErrors]         = useState({});
  const [openSections,   setOpenSections]   = useState({ customer: true, job: true, items: true });
  const [expandedItems,  setExpandedItems]  = useState(() => new Set(sheet.lineItems.map(li => li.id)));

  // ── Derived: search results & customer jobs ────────────────────────────────
  const searchResults = useMemo(() =>
    searchCustomers(customerSearch, allCustomers),
    [customerSearch, allCustomers]
  );


  // ── Real-time duplicate detection (new customer mode) ─────────────────────
  useEffect(() => {
    if (customerMode !== 'new' || prelinkedCustomer) { setDuplicates([]); return; }
    const { customerName, phone, email, siteAddress } = sheet;
    if (!customerName.trim() && !phone.trim() && !email.trim()) { setDuplicates([]); return; }
    const matches = findDuplicates(customerName, phone, email, siteAddress, allCustomers);
    setDuplicates(matches);
    if (matches.length === 0) setDuplicateDismissed(false);
  }, [sheet.customerName, sheet.phone, sheet.email, sheet.siteAddress, customerMode, allCustomers, prelinkedCustomer]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sheet.status === 'Submitted') return;
    const t = setInterval(() => { saveMeasureSheet({ ...sheet, status: 'Draft' }); setSavedAt(new Date()); }, 30000);
    return () => clearInterval(t);
  }, [sheet]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const setField     = (field, value) => setSheet(s => ({ ...s, [field]: value }));
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));
  const toggleItemExpand = (iid) => setExpandedItems(prev => {
    const next = new Set(prev);
    next.has(iid) ? next.delete(iid) : next.add(iid);
    return next;
  });

  const setLineItem = (idx, field, value) => setSheet(s => {
    const items = [...s.lineItems];
    items[idx] = { ...items[idx], [field]: value };
    return { ...s, lineItems: items };
  });

  const addLineItem = () => {
    const newItem = EMPTY_LINE_ITEM();
    setSheet(s => ({ ...s, lineItems: [...s.lineItems, newItem] }));
    setExpandedItems(prev => new Set([...prev, newItem.id])); // auto-expand specs
  };

  const copyLineItem = (idx) => {
    const source = sheet.lineItems[idx];
    const copy = { ...source, id: uuidv4(), location: source.location ? `${source.location} (copy)` : '' };
    setSheet(s => {
      const items = [...s.lineItems];
      items.splice(idx + 1, 0, copy); // insert right after the source
      return { ...s, lineItems: items };
    });
    setExpandedItems(prev => new Set([...prev, copy.id])); // auto-expand the copy
  };

  const removeLineItem = (idx) => {
    if (sheet.lineItems.length <= 1) return;
    setSheet(s => ({ ...s, lineItems: s.lineItems.filter((_, i) => i !== idx) }));
  };

  // Use existing customer
  const handleUseCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch('');
    setDuplicates([]);
    setSheet(s => ({
      ...s,
      customerId:    customer.id,
      customerName:  customer.name    || '',
      phone:         customer.phone   || '',
      email:         customer.email   || '',
      siteAddress:   customer.address || '',
      billingAddress: customer.billingAddress || '',
      preferredContact: customer.preferredContact || 'Any',
      customerNotes: customer.notes   || '',
    }));
  };

  const handleClearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setSheet(s => ({ ...s, customerId: null, customerName: '', phone: '', email: '', siteAddress: '', billingAddress: '', customerNotes: '' }));
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    const hasCustomer = prelinkedCustomer || selectedCustomer || (customerMode === 'new');

    if (!hasCustomer) {
      e.customer = 'Please select or create a customer.';
    } else if (customerMode === 'new' && !selectedCustomer) {
      if (!sheet.customerName.trim()) e.customerName = 'Customer name is required';
      if (!sheet.phone.trim() && !sheet.email.trim()) e.phone = 'Phone or email is required';
      if (!sheet.siteAddress.trim()) e.siteAddress = 'Site address is required';
      // Require duplicate acknowledgement if high-confidence matches exist
      if (duplicates.some(d => d.confidence === 'high') && !duplicateDismissed) {
        e.duplicate = 'Please acknowledge the possible duplicate customer above.';
      }
    }

    if (!sheet.measurer.trim()) e.measurer = 'Measurer is required';
    sheet.lineItems.forEach((item, i) => {
      if (!item.location.trim())  e[`item_${i}_location`]    = 'Location required';
      if (!item.productTypeId)    e[`item_${i}_productType`] = 'Product type required';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSaveDraft = () => {
    saveMeasureSheet({ ...sheet, status: 'Draft' });
    setSavedAt(new Date());
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) {
      setOpenSections({ customer: true, job: true, items: true });
      return;
    }

    setSubmitting(true);
    try {
      // Resolve / create customer
      let customer;
      if (prelinkedCustomer) {
        customer = prelinkedCustomer;
      } else if (selectedCustomer) {
        customer = selectedCustomer;
      } else {
        customer = findOrCreateCustomer({
          name:             sheet.customerName,
          phone:            sheet.phone,
          email:            sheet.email,
          address:          sheet.siteAddress,
          billingAddress:   sheet.billingAddress || sheet.siteAddress,
          preferredContact: sheet.preferredContact,
          notes:            sheet.customerNotes,
        });
      }

      const finalSheet = { ...sheet, customerId: customer.id, status: 'Submitted' };
      saveMeasureSheet(finalSheet);

      const job = createJobFromMeasureSheet(sheet, customer);
      const finalSheetWithJob = { ...finalSheet, jobId: job?.id };
      saveMeasureSheet(finalSheetWithJob);

      // Wait for Supabase confirmation before showing success.
      // Sequential order respects FK constraints: customer → job → measure_sheet.
      await syncNow([
        { table: 'customers',      record: customer },
        { table: 'jobs',           record: job },
        { table: 'measure_sheets', record: finalSheetWithJob },
      ], { sequential: true });

      setSheet(finalSheet);
      setSubmittedJobId(job?.id || null);
      setSubmitted(true);
    } catch (err) {
      console.error('[handleSubmit]', err);
      setErrors(e => ({ ...e, _submit: err.message || 'Submission failed. Please try again.' }));
      setOpenSections({ customer: true, job: true, items: true });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submitted screen ───────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Measure Sheet Submitted!</h2>
        <p className="text-slate-500 text-sm mb-6 max-w-sm">
          The measure sheet has been saved and a new job has been created automatically.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          {submittedJobId && (
            <button onClick={() => navigate(`/jobs/${submittedJobId}`)}
              className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
              View Job
            </button>
          )}
          <button onClick={() => navigate('/jobs')}
            className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
            View All Jobs
          </button>
          <button onClick={() => navigate('/measure-sheets/new')}
            className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
            New Measure Sheet
          </button>
        </div>
      </div>
    );
  }

  const hasErrors   = Object.keys(errors).length > 0;
  const highDuplicate = duplicates.some(d => d.confidence === 'high');

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">
            {isEdit ? 'Edit Measure Sheet' : prelinkedCustomer ? `New Measure Sheet — ${prelinkedCustomer.name}` : 'New Measure Sheet'}
          </h1>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sheet.status === 'Submitted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {sheet.status}
            </span>
            {savedAt && <span className="text-xs text-slate-400">Auto-saved {savedAt.toLocaleTimeString()}</span>}
          </div>
        </div>
      </div>

      {/* Validation banner */}
      {hasErrors && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700">Please fix the following:</p>
            <ul className="text-xs text-red-600 mt-1 space-y-0.5">
              {Object.values(errors).map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* ── SECTION 1: Customer ─────────────────────────────────────────────── */}
      {prelinkedCustomer ? (
        /* Locked banner — launched from a customer profile */
        <Card className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Customer</p>
                <p className="font-semibold text-slate-900">{prelinkedCustomer.name}</p>
                <div className="mt-1 space-y-0.5 text-sm text-slate-500">
                  {prelinkedCustomer.phone && <p>{prelinkedCustomer.phone}</p>}
                  {prelinkedCustomer.email && <p>{prelinkedCustomer.email}</p>}
                  {prelinkedCustomer.address && <p>{prelinkedCustomer.address}</p>}
                </div>
              </div>
            </div>
            <button onClick={() => navigate(`/customers/${prelinkedCustomer.id}`)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors flex-shrink-0">
              <Edit3 size={12} /> Edit Customer
            </button>
          </div>
        </Card>
      ) : (
        <Section
          title="Customer"
          icon={<User size={15} />}
          open={openSections.customer}
          onToggle={() => toggleSection('customer')}
        >
          <div className="space-y-4">

            {/* Mode toggle */}
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => { setCustomerMode('select'); setDuplicates([]); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${customerMode === 'select' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <UserCheck size={15} /> Select Existing Customer
              </button>
              <button
                onClick={() => { setCustomerMode('new'); setSelectedCustomer(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors border-l border-slate-200 ${customerMode === 'new' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <UserPlus size={15} /> Create New Customer
              </button>
            </div>

            {/* ── SELECT EXISTING ── */}
            {customerMode === 'select' && (
              <div className="space-y-3">
                {selectedCustomer ? (
                  <>
                    <SelectedCustomerCard
                      customer={selectedCustomer}
                      onClear={handleClearCustomer}
                      navigate={navigate}
                    />

                    {/* Job note */}
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                      <p className="text-xs text-slate-600">A new job will be created automatically when you submit this measure sheet.</p>
                    </div>
                  </>
                ) : (
                  <>
                    {errors.customer && (
                      <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.customer}</p>
                    )}
                    <CustomerSearchInput
                      value={customerSearch}
                      onChange={setCustomerSearch}
                      placeholder="Search by name, phone, email or address…"
                      onEnter={() => {
                        if (customerSearch.trim() && searchResults.length === 0) {
                          setField('customerName', customerSearch.trim());
                          setCustomerMode('new');
                          setSelectedCustomer(null);
                        }
                      }}
                    />

                    {customerSearch.length >= 2 && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                        {searchResults.length === 0 ? (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm text-slate-500">No customers found for <strong>{customerSearch}</strong></p>
                            <button onClick={() => setCustomerMode('new')}
                              className="mt-2 text-xs text-amber-600 hover:underline">
                              Create new customer instead →
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                              <p className="text-xs text-slate-500">{searchResults.length} match{searchResults.length !== 1 ? 'es' : ''}</p>
                            </div>
                            {searchResults.map(c => {
                              const jobCount = allJobs.filter(j => j.customerId === c.id).length;
                              return <CustomerResultCard key={c.id} customer={c} jobCount={jobCount} onSelect={handleUseCustomer} />;
                            })}
                          </>
                        )}
                      </div>
                    )}

                    {!customerSearch && (
                      <p className="text-xs text-slate-400 text-center py-2">
                        Type a name, phone number, or address to search {allCustomers.length} customers.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── CREATE NEW ── */}
            {customerMode === 'new' && (
              <div className="space-y-4">
                {/* Duplicate matches */}
                {duplicates.length > 0 && (
                  <div className="space-y-2">
                    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border ${highDuplicate ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${highDuplicate ? 'text-red-500' : 'text-amber-500'}`} />
                      <p className={`text-xs font-medium ${highDuplicate ? 'text-red-700' : 'text-amber-700'}`}>
                        {highDuplicate
                          ? 'Possible duplicate — a customer with the same email or phone already exists.'
                          : `${duplicates.length} possible existing customer${duplicates.length !== 1 ? 's' : ''} found.`}
                      </p>
                    </div>

                    {duplicates.map((m, i) => (
                      <DuplicateMatchCard
                        key={m.customer.id}
                        match={m}
                        onUse={handleUseCustomer}
                        navigate={navigate}
                      />
                    ))}

                    {/* Dismiss / confirm */}
                    <label className="flex items-start gap-2.5 cursor-pointer group mt-2">
                      <input
                        type="checkbox"
                        checked={duplicateDismissed}
                        onChange={e => setDuplicateDismissed(e.target.checked)}
                        className="mt-0.5 accent-amber-500"
                      />
                      <span className="text-xs text-slate-600 group-hover:text-slate-800 transition-colors">
                        I understand this may create a duplicate customer and want to continue creating a new customer.
                      </span>
                    </label>
                    {errors.duplicate && (
                      <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.duplicate}</p>
                    )}
                  </div>
                )}

                {/* New customer form */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField label="Customer Name *" error={errors.customerName}>
                    <input value={sheet.customerName} onChange={e => setField('customerName', e.target.value)}
                      placeholder="Full name" className={inputCls(errors.customerName)} />
                  </FormField>
                  <FormField label="Phone Number" error={errors.phone}>
                    <input value={sheet.phone} onChange={e => setField('phone', e.target.value)}
                      placeholder="04XX XXX XXX" className={inputCls(errors.phone)} />
                  </FormField>
                  <FormField label="Email Address">
                    <input type="email" value={sheet.email} onChange={e => setField('email', e.target.value)}
                      placeholder="customer@email.com" className={inputCls()} />
                  </FormField>
                  <FormField label="Preferred Contact">
                    <select value={sheet.preferredContact} onChange={e => setField('preferredContact', e.target.value)} className={inputCls()}>
                      {['Phone','Email','SMS','Any'].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Site Address *" error={errors.siteAddress} className="sm:col-span-2">
                    <input value={sheet.siteAddress} onChange={e => setField('siteAddress', e.target.value)}
                      placeholder="Street address, Suburb STATE Postcode" className={inputCls(errors.siteAddress)} />
                  </FormField>
                  <FormField label="Billing Address (if different)" className="sm:col-span-2">
                    <input value={sheet.billingAddress} onChange={e => setField('billingAddress', e.target.value)}
                      placeholder="Leave blank if same as site" className={inputCls()} />
                  </FormField>
                  <FormField label="Customer Notes" className="sm:col-span-2">
                    <textarea value={sheet.customerNotes} onChange={e => setField('customerNotes', e.target.value)}
                      rows={2} placeholder="Preferences, communication notes…" className={inputCls() + ' resize-none'} />
                  </FormField>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── SECTION 2: Job Details ──────────────────────────────────────────── */}
      <Section title="Job Details" icon={<Briefcase size={15} />} open={openSections.job} onToggle={() => toggleSection('job')}>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Job Type">
            <select value={sheet.jobType} onChange={e => setField('jobType', e.target.value)} className={inputCls()}>
              <option value="">Select job type…</option>
              {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Urgency">
            <select value={sheet.urgency} onChange={e => setField('urgency', e.target.value)} className={inputCls()}>
              {URGENCY_LEVELS.map(u => <option key={u}>{u}</option>)}
            </select>
          </FormField>
          <FormField label="Measure Date">
            <input type="date" value={sheet.measureDate} onChange={e => setField('measureDate', e.target.value)} className={inputCls()} />
          </FormField>
          <FormField label="Salesperson / Measurer *" error={errors.measurer}>
            <select value={sheet.measurer} onChange={e => setField('measurer', e.target.value)} className={inputCls(errors.measurer)}>
              <option value="">Select staff member…</option>
              {staff.map(s => (
                <option key={s.id} value={s.fullName || s.displayName}>
                  {s.fullName || s.displayName}{s.positionTitle ? ` — ${s.positionTitle}` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Access Instructions" className="sm:col-span-2">
            <input value={sheet.accessInstructions} onChange={e => setField('accessInstructions', e.target.value)}
              placeholder="Key location, gate codes, contact on arrival…" className={inputCls()} />
          </FormField>
          <FormField label="Parking Notes">
            <input value={sheet.parkingNotes} onChange={e => setField('parkingNotes', e.target.value)}
              placeholder="Street parking, driveway available…" className={inputCls()} />
          </FormField>
          <FormField label="Site Condition Notes">
            <input value={sheet.siteConditionNotes} onChange={e => setField('siteConditionNotes', e.target.value)}
              placeholder="Renovating, new build, pets…" className={inputCls()} />
          </FormField>
          <FormField label="Internal Notes" className="sm:col-span-2">
            <textarea value={sheet.internalNotes} onChange={e => setField('internalNotes', e.target.value)}
              rows={2} placeholder="Notes for office use only…" className={inputCls() + ' resize-none'} />
          </FormField>
        </div>
      </Section>

      {/* ── SECTION 3: Line Items ───────────────────────────────────────────── */}
      <Section
        title={`Product / Opening Details (${sheet.lineItems.length} item${sheet.lineItems.length !== 1 ? 's' : ''})`}
        icon={<ClipboardList size={15} />}
        open={openSections.items}
        onToggle={() => toggleSection('items')}
      >
        {openSections.items && (
          <div className="space-y-4">
            {sheet.lineItems.map((item, idx) => {
              const isExpanded = expandedItems.has(item.id);
              return (
                <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Item header */}
                  <div className="bg-gradient-to-r from-amber-50 to-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Location *</label>
                        <input value={item.location} onChange={e => setLineItem(idx, 'location', e.target.value)}
                          placeholder="e.g. Master Bedroom"
                          className={inp() + (errors[`item_${idx}_location`] ? ' border-red-300 ring-1 ring-red-300' : '')} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Product *</label>
                        <select value={item.productTypeId}
                          onChange={e => {
                            const pt = productTypes.find(p => p.id === e.target.value);
                            setLineItem(idx, 'productTypeId', e.target.value);
                            setLineItem(idx, 'productNameSnapshot', pt?.name || '');
                          }}
                          className={inp() + (errors[`item_${idx}_productType`] ? ' border-red-300 ring-1 ring-red-300' : '')}>
                          <option value="">Select product…</option>
                          {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <button onClick={() => copyLineItem(idx)}
                      className="flex-shrink-0 text-slate-300 hover:text-amber-500 transition-colors p-1 rounded" title="Copy to new line">
                      <Copy size={15} />
                    </button>
                    <button onClick={() => removeLineItem(idx)}
                      className="flex-shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1 rounded" title="Remove item">
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* Core fields */}
                  <div className="px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Qty</label>
                      <input type="number" min="1" value={item.quantity}
                        onChange={e => setLineItem(idx, 'quantity', Number(e.target.value))} className={inp()} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Width (mm)</label>
                      <input type="number" min="1" value={item.widthMm}
                        onChange={e => setLineItem(idx, 'widthMm', e.target.value)} placeholder="e.g. 1800" className={inp()} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Drop (mm)</label>
                      <input type="number" min="1" value={item.dropMm}
                        onChange={e => setLineItem(idx, 'dropMm', e.target.value)} placeholder="e.g. 2400" className={inp()} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Fabric / Colour</label>
                      <input value={item.fabricColour}
                        onChange={e => setLineItem(idx, 'fabricColour', e.target.value)} placeholder="e.g. Arctic White" className={inp()} />
                    </div>
                  </div>

                  {/* Specs toggle */}
                  <div className="px-4 pb-3">
                    <button type="button" onClick={() => toggleItemExpand(item.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors">
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      {isExpanded ? 'Hide specifications' : 'Show specifications'}
                    </button>
                  </div>

                  {/* Expanded specs */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/40 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <SpecSelect label="Control"              value={item.control}           onChange={v => setLineItem(idx,'control',v)}           options={CONTROL_OPTIONS} />
                      <SpecSelect label="Return"               value={item.returnSide}        onChange={v => setLineItem(idx,'returnSide',v)}        options={RETURN_OPTIONS} />
                      <SpecSelect label="Motor Side"           value={item.motorSide}         onChange={v => setLineItem(idx,'motorSide',v)}         options={MOTOR_SIDE_OPTIONS} />
                      <SpecSelect label="Fixing"               value={item.fixing}            onChange={v => setLineItem(idx,'fixing',v)}            options={FIXING_OPTIONS} />
                      <SpecSelect label="Heading"              value={item.heading}           onChange={v => setLineItem(idx,'heading',v)}           options={HEADING_OPTIONS} />
                      <SpecSelect label="Hem"                  value={item.hem}               onChange={v => setLineItem(idx,'hem',v)}               options={HEM_OPTIONS} />
                      <SpecSelect label="Track / Base Bar Colour" value={item.trackBaseBarColour} onChange={v => setLineItem(idx,'trackBaseBarColour',v)} options={TRACK_COLOUR_OPTIONS} />
                      <SpecSelect label="Operation Type"       value={item.trackType}         onChange={v => setLineItem(idx,'trackType',v)}         options={OPERATION_TYPE_OPTIONS} />
                      <SpecSelect label="Base Bar Type"        value={item.baseBarType}       onChange={v => setLineItem(idx,'baseBarType',v)}       options={BASE_BAR_TYPE_OPTIONS} />
                      <SpecSelect label="Chain Colour"         value={item.chainColour}       onChange={v => setLineItem(idx,'chainColour',v)}       options={CHAIN_COLOUR_OPTIONS} />

                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Attached Lining</label>
                        <div className="flex gap-2">
                          {[true, false].map(val => (
                            <button key={String(val)} type="button" onClick={() => setLineItem(idx,'attachedLining',val)}
                              className={`flex-1 max-w-[120px] text-xs font-medium py-1.5 rounded-lg border transition-colors ${
                                item.attachedLining === val ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}>
                              {val ? 'Enabled' : 'Disabled'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {item.attachedLining && (
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Lining Fabric / Colour</label>
                          <input value={item.liningFabricColour}
                            onChange={e => setLineItem(idx,'liningFabricColour',e.target.value)}
                            placeholder="e.g. Blockout White" className={inp()} />
                        </div>
                      )}

                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                        <textarea value={item.notes}
                          onChange={e => setLineItem(idx,'notes',e.target.value)}
                          rows={2} placeholder="Additional notes…" className={inp() + ' resize-none'} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <button type="button" onClick={addLineItem}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-amber-400 text-slate-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl transition-colors">
              <Plus size={16} /> Add Line Item
            </button>
          </div>
        )}
      </Section>

      {/* Sticky action bar — sits above the mobile bottom nav (64px) on small screens */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 z-20 lg:pl-72">
        {errors._submit && (
          <p className="text-xs text-red-600 text-center mb-2 flex items-center justify-center gap-1">
            <AlertCircle size={12} /> {errors._submit}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleSaveDraft} disabled={submitting}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <Save size={15} /> Save Draft
          </button>
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-slate-400 hidden sm:block">Saved {savedAt.toLocaleTimeString()}</span>}
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition-colors">
              {submitting ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Submitting…</> : <><Send size={15} /> Submit & Create Job</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

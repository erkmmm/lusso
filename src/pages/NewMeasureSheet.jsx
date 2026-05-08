import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft, Plus, Trash2, Save, Send, CheckCircle2,
  ChevronDown, ChevronUp, User, MapPin, Briefcase,
  ClipboardList, AlertCircle,
} from 'lucide-react';
import {
  saveMeasureSheet, getMeasureSheet, findOrCreateCustomer,
  createJobFromMeasureSheet, getStaff, getActiveProductTypes,
  CONTROL_OPTIONS, RETURN_OPTIONS, MOTOR_SIDE_OPTIONS, FIXING_OPTIONS,
  HEADING_OPTIONS, HEM_OPTIONS, TRACK_COLOUR_OPTIONS, BASE_BAR_TYPE_OPTIONS, CHAIN_COLOUR_OPTIONS,
  URGENCY_LEVELS, JOB_TYPES,
} from '../store/data';
import Card from '../components/Card';

const EMPTY_LINE_ITEM = () => ({
  id: uuidv4(),
  location: '',
  productTypeId: '',
  productNameSnapshot: '',
  quantity: 1,
  widthMm: '',
  dropMm: '',
  fabricColour: '',
  control: '',
  returnSide: '',
  motorSide: '',
  fixing: '',
  heading: '',
  attachedLining: false,
  liningFabricColour: '',
  hem: '',
  trackBaseBarColour: '',
  baseBarType: '',
  chainColour: '',
  notes: '',
  sortOrder: 0,
});

const EMPTY_SHEET = () => ({
  id: uuidv4(),
  status: 'Draft',
  createdAt: new Date().toISOString(),
  // Customer
  customerName: '',
  phone: '',
  email: '',
  siteAddress: '',
  billingAddress: '',
  preferredContact: 'Phone',
  customerNotes: '',
  // Job
  jobType: '',
  measureDate: new Date().toISOString().slice(0, 10),
  measurer: '',
  urgency: 'Normal',
  accessInstructions: '',
  parkingNotes: '',
  siteConditionNotes: '',
  internalNotes: '',
  // Line items
  lineItems: [EMPTY_LINE_ITEM()],
});

export default function NewMeasureSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id && id !== 'new');
  const staff = getStaff();

  const [sheet, setSheet] = useState(() => {
    if (isEdit) return getMeasureSheet(id) || EMPTY_SHEET();
    return EMPTY_SHEET();
  });
  const [savedAt, setSavedAt] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});
  const [openSections, setOpenSections] = useState({ customer: true, job: true, items: true });
  const [expandedItems, setExpandedItems] = useState(() => new Set(sheet.lineItems.map(li => li.id)));
  const productTypes = getActiveProductTypes();

  const toggleItemExpand = (id) => setExpandedItems(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Auto-save draft every 30s
  useEffect(() => {
    if (sheet.status === 'Submitted') return;
    const timer = setInterval(() => {
      saveMeasureSheet({ ...sheet, status: 'Draft' });
      setSavedAt(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, [sheet]);

  const setField = (field, value) => setSheet(s => ({ ...s, [field]: value }));

  const setLineItem = (idx, field, value) => {
    setSheet(s => {
      const items = [...s.lineItems];
      items[idx] = { ...items[idx], [field]: value };
      return { ...s, lineItems: items };
    });
  };

  const addLineItem = () => setSheet(s => ({ ...s, lineItems: [...s.lineItems, EMPTY_LINE_ITEM()] }));

  const removeLineItem = (idx) => {
    if (sheet.lineItems.length <= 1) return;
    setSheet(s => ({ ...s, lineItems: s.lineItems.filter((_, i) => i !== idx) }));
  };

  const validate = () => {
    const e = {};
    if (!sheet.customerName.trim()) e.customerName = 'Customer name is required';
    if (!sheet.phone.trim() && !sheet.email.trim()) e.phone = 'Phone or email is required';
    if (!sheet.siteAddress.trim()) e.siteAddress = 'Site address is required';
    if (!sheet.measurer.trim()) e.measurer = 'Measurer is required';
    sheet.lineItems.forEach((item, i) => {
      if (!item.location.trim()) e[`item_${i}_location`] = 'Location required';
      if (!item.productTypeId) e[`item_${i}_productType`] = 'Product type required';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSaveDraft = () => {
    saveMeasureSheet({ ...sheet, status: 'Draft' });
    setSavedAt(new Date());
  };

  const handleSubmit = () => {
    if (!validate()) {
      setOpenSections({ customer: true, job: true, items: true });
      return;
    }
    const customer = findOrCreateCustomer({
      name: sheet.customerName,
      phone: sheet.phone,
      email: sheet.email,
      address: sheet.siteAddress,
      billingAddress: sheet.billingAddress || sheet.siteAddress,
      preferredContact: sheet.preferredContact,
      notes: sheet.customerNotes,
    });
    const finalSheet = {
      ...sheet,
      customerId: customer.id,
      status: 'Submitted',
    };
    saveMeasureSheet(finalSheet);
    const job = createJobFromMeasureSheet(sheet, customer);
    // Update sheet with jobId
    saveMeasureSheet({ ...finalSheet, jobId: job.id });
    setSheet(finalSheet);
    setSubmitted(true);
  };

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

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
        <div className="flex gap-3">
          <button onClick={() => navigate('/jobs')}
            className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
            View Jobs
          </button>
          <button onClick={() => navigate('/measure-sheets/new')}
            className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
            New Measure Sheet
          </button>
        </div>
      </div>
    );
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">{isEdit ? 'Edit Measure Sheet' : 'New Measure Sheet'}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sheet.status === 'Submitted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {sheet.status}
            </span>
            {savedAt && <span className="text-xs text-slate-400">Auto-saved {savedAt.toLocaleTimeString()}</span>}
          </div>
        </div>
      </div>

      {/* Validation error banner */}
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

      {/* ── SECTION 1: Customer Details ── */}
      <Section
        title="Customer Details"
        icon={<User size={15} />}
        open={openSections.customer}
        onToggle={() => toggleSection('customer')}
      >
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
          <FormField label="Preferred Contact Method">
            <select value={sheet.preferredContact} onChange={e => setField('preferredContact', e.target.value)} className={inputCls()}>
              {['Phone', 'Email', 'SMS', 'Any'].map(o => <option key={o}>{o}</option>)}
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
      </Section>

      {/* ── SECTION 2: Job Details ── */}
      <Section
        title="Job Details"
        icon={<Briefcase size={15} />}
        open={openSections.job}
        onToggle={() => toggleSection('job')}
      >
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
              {staff.map(s => <option key={s.id} value={s.name}>{s.name} ({s.role})</option>)}
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

      {/* ── SECTION 3: Product / Opening Details ── */}
      <Section
        title={`Product / Opening Details (${sheet.lineItems.length} item${sheet.lineItems.length !== 1 ? 's' : ''})`}
        icon={<ClipboardList size={15} />}
        open={openSections.items}
        onToggle={() => toggleSection('items')}
      >
        {/* Line Items */}
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
                        <input
                          value={item.location}
                          onChange={e => setLineItem(idx, 'location', e.target.value)}
                          placeholder="e.g. Master Bedroom"
                          className={inp() + (errors[`item_${idx}_location`] ? ' border-red-300 ring-1 ring-red-300' : '')}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Product *</label>
                        <select
                          value={item.productTypeId}
                          onChange={e => {
                            const pt = productTypes.find(p => p.id === e.target.value);
                            setLineItem(idx, 'productTypeId', e.target.value);
                            setLineItem(idx, 'productNameSnapshot', pt?.name || '');
                          }}
                          className={inp() + (errors[`item_${idx}_productType`] ? ' border-red-300 ring-1 ring-red-300' : '')}
                        >
                          <option value="">Select product…</option>
                          {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => removeLineItem(idx)}
                      className="flex-shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1 rounded"
                      title="Remove item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* Core fields */}
                  <div className="px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Qty</label>
                      <input
                        type="number" min="1"
                        value={item.quantity}
                        onChange={e => setLineItem(idx, 'quantity', Number(e.target.value))}
                        className={inp()}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Width (mm)</label>
                      <input
                        type="number" min="1"
                        value={item.widthMm}
                        onChange={e => setLineItem(idx, 'widthMm', e.target.value)}
                        placeholder="e.g. 1800"
                        className={inp()}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Drop (mm)</label>
                      <input
                        type="number" min="1"
                        value={item.dropMm}
                        onChange={e => setLineItem(idx, 'dropMm', e.target.value)}
                        placeholder="e.g. 2400"
                        className={inp()}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Fabric / Colour</label>
                      <input
                        value={item.fabricColour}
                        onChange={e => setLineItem(idx, 'fabricColour', e.target.value)}
                        placeholder="e.g. Arctic White"
                        className={inp()}
                      />
                    </div>
                  </div>

                  {/* Specs toggle */}
                  <div className="px-4 pb-3">
                    <button
                      type="button"
                      onClick={() => toggleItemExpand(item.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      {isExpanded ? 'Hide specifications' : 'Show specifications'}
                    </button>
                  </div>

                  {/* Expanded spec fields */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/40 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {/* Control */}
                      <SpecSelect label="Control" value={item.control}
                        onChange={v => setLineItem(idx, 'control', v)} options={CONTROL_OPTIONS} />
                      {/* Return */}
                      <SpecSelect label="Return" value={item.returnSide}
                        onChange={v => setLineItem(idx, 'returnSide', v)} options={RETURN_OPTIONS} />
                      {/* Motor Side */}
                      <SpecSelect label="Motor Side" value={item.motorSide}
                        onChange={v => setLineItem(idx, 'motorSide', v)} options={MOTOR_SIDE_OPTIONS} />
                      {/* Fixing */}
                      <SpecSelect label="Fixing" value={item.fixing}
                        onChange={v => setLineItem(idx, 'fixing', v)} options={FIXING_OPTIONS} />
                      {/* Heading */}
                      <SpecSelect label="Heading" value={item.heading}
                        onChange={v => setLineItem(idx, 'heading', v)} options={HEADING_OPTIONS} />
                      {/* Hem */}
                      <SpecSelect label="Hem" value={item.hem}
                        onChange={v => setLineItem(idx, 'hem', v)} options={HEM_OPTIONS} />
                      {/* Track / Base Bar Colour */}
                      <SpecSelect label="Track / Base Bar Colour" value={item.trackBaseBarColour}
                        onChange={v => setLineItem(idx, 'trackBaseBarColour', v)} options={TRACK_COLOUR_OPTIONS} />
                      {/* Base Bar Type */}
                      <SpecSelect label="Base Bar Type" value={item.baseBarType}
                        onChange={v => setLineItem(idx, 'baseBarType', v)} options={BASE_BAR_TYPE_OPTIONS} />
                      {/* Chain Colour */}
                      <SpecSelect label="Chain Colour" value={item.chainColour}
                        onChange={v => setLineItem(idx, 'chainColour', v)} options={CHAIN_COLOUR_OPTIONS} />

                      {/* Attached Lining toggle */}
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Attached Lining</label>
                        <div className="flex gap-2">
                          {[true, false].map(val => (
                            <button
                              key={String(val)}
                              type="button"
                              onClick={() => setLineItem(idx, 'attachedLining', val)}
                              className={`flex-1 max-w-[120px] text-xs font-medium py-1.5 rounded-lg border transition-colors ${
                                item.attachedLining === val
                                  ? 'bg-amber-500 text-white border-amber-500'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {val ? 'Enabled' : 'Disabled'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Conditional: Lining Fabric / Colour */}
                      {item.attachedLining && (
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Lining Fabric / Colour</label>
                          <input
                            value={item.liningFabricColour}
                            onChange={e => setLineItem(idx, 'liningFabricColour', e.target.value)}
                            placeholder="e.g. Blockout White"
                            className={inp()}
                          />
                        </div>
                      )}

                      {/* Notes */}
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                        <textarea
                          value={item.notes}
                          onChange={e => setLineItem(idx, 'notes', e.target.value)}
                          rows={2}
                          placeholder="Additional notes…"
                          className={inp() + ' resize-none'}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add item button */}
            <button
              type="button"
              onClick={addLineItem}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-amber-400 text-slate-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl transition-colors"
            >
              <Plus size={16} /> Add Line Item
            </button>
          </div>
        )}
      </Section>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 z-10 lg:pl-72">
        <button onClick={handleSaveDraft}
          className="flex items-center gap-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
          <Save size={15} /> Save Draft
        </button>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-slate-400 hidden sm:block">Saved {savedAt.toLocaleTimeString()}</span>}
          <button onClick={handleSubmit}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition-colors">
            <Send size={15} /> Submit & Create Job
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, open, onToggle, children }) {
  return (
    <Card>
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between text-left"
      >
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          {icon}{title}
        </h2>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </Card>
  );
}

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
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

const inputCls = (error) =>
  `w-full border rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 transition-colors ${
    error
      ? 'border-red-300 focus:ring-red-300 bg-red-50'
      : 'border-slate-200 focus:ring-amber-400 bg-white'
  }`;

const inp = () => 'w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400';

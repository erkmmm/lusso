import { v4 as uuidv4 } from 'uuid';
import { db, batchUpsertCustomers, batchUpsertPricedItems, hydrateFromSupabase } from './db';
import { supabase } from '../lib/supabase';

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_CUSTOMERS = [
  {
    id: 'cust-1',
    name: 'Sarah Mitchell',
    phone: '0412 345 678',
    email: 'sarah.mitchell@email.com',
    address: '14 Rosewood Drive, Brighton VIC 3186',
    billingAddress: '14 Rosewood Drive, Brighton VIC 3186',
    preferredContact: 'Email',
    notes: 'Prefers morning appointments',
    createdAt: '2025-03-10T09:00:00.000Z',
    updatedAt: '2025-04-15T14:30:00.000Z',
  },
  {
    id: 'cust-2',
    name: 'James & Karen Thornton',
    phone: '0423 456 789',
    email: 'jkthornton@gmail.com',
    address: '7 Harbour View Crescent, Mosman NSW 2088',
    billingAddress: '7 Harbour View Crescent, Mosman NSW 2088',
    preferredContact: 'Phone',
    notes: 'New build — access via site foreman Derek (0400 111 222)',
    createdAt: '2025-03-22T10:00:00.000Z',
    updatedAt: '2025-04-20T09:15:00.000Z',
  },
  {
    id: 'cust-3',
    name: 'Priya Sharma',
    phone: '0434 567 890',
    email: 'priya.sharma@hotmail.com',
    address: '3/42 Park Street, South Yarra VIC 3141',
    billingAddress: '3/42 Park Street, South Yarra VIC 3141',
    preferredContact: 'SMS',
    notes: '',
    createdAt: '2025-04-01T11:30:00.000Z',
    updatedAt: '2025-04-25T16:00:00.000Z',
  },
];

const SEED_JOBS = [
  {
    id: 'job-1',
    customerId: 'cust-1',
    jobNumber: 'LUS-0001',
    title: 'Brighton Residence – Full Window Treatment',
    status: 'Quoted',
    jobType: 'Curtains & Blinds',
    assignedStaff: 'Alex Chen',
    measureDate: '2025-04-10',
    quoteDueDate: '2025-04-17',
    installDate: '2025-05-12',
    urgency: 'Normal',
    accessInstructions: 'Key under mat at front door',
    parkingNotes: 'Street parking available on Rosewood Drive',
    siteConditionNotes: 'New plaster — protect floors',
    internalNotes: 'Customer wants premium fabrics only',
    createdAt: '2025-04-10T09:30:00.000Z',
    updatedAt: '2025-04-15T14:30:00.000Z',
  },
  {
    id: 'job-2',
    customerId: 'cust-2',
    jobNumber: 'LUS-0002',
    title: 'Mosman New Build – All Rooms',
    status: 'Measure Booked',
    jobType: 'Roller Blinds',
    assignedStaff: 'Jordan Lee',
    measureDate: '2025-05-08',
    quoteDueDate: '2025-05-15',
    installDate: null,
    urgency: 'High',
    accessInstructions: 'Contact site foreman Derek on 0400 111 222',
    parkingNotes: 'Construction site parking on Harbour View',
    siteConditionNotes: 'Under construction — hard hat required',
    internalNotes: 'Builder wants all blinds installed before handover June 1',
    createdAt: '2025-04-20T10:00:00.000Z',
    updatedAt: '2025-04-20T10:00:00.000Z',
  },
  {
    id: 'job-3',
    customerId: 'cust-3',
    jobNumber: 'LUS-0003',
    title: 'South Yarra Apartment – Bedroom & Living',
    status: 'Approved',
    jobType: 'Sheers & Blockout',
    assignedStaff: 'Alex Chen',
    measureDate: '2025-04-22',
    quoteDueDate: '2025-04-29',
    installDate: '2025-05-20',
    urgency: 'Normal',
    accessInstructions: 'Buzz unit 3 on intercom',
    parkingNotes: 'Paid parking on Park Street',
    siteConditionNotes: 'Apartment — no outdoor access',
    internalNotes: '',
    createdAt: '2025-04-22T11:30:00.000Z',
    updatedAt: '2025-04-28T09:00:00.000Z',
  },
  {
    id: 'job-4',
    customerId: 'cust-1',
    jobNumber: 'LUS-0004',
    title: 'Brighton Residence – Outdoor Awning',
    status: 'New Enquiry',
    jobType: 'Awnings',
    assignedStaff: 'Jordan Lee',
    measureDate: null,
    quoteDueDate: null,
    installDate: null,
    urgency: 'Low',
    accessInstructions: '',
    parkingNotes: '',
    siteConditionNotes: '',
    internalNotes: 'Follow up call needed',
    createdAt: '2025-05-01T08:00:00.000Z',
    updatedAt: '2025-05-01T08:00:00.000Z',
  },
  {
    id: 'job-5',
    customerId: 'cust-2',
    jobNumber: 'LUS-0005',
    title: 'Mosman – Office Roller Blinds',
    status: 'Ordered',
    jobType: 'Commercial Blinds',
    assignedStaff: 'Sam Russo',
    measureDate: '2025-03-15',
    quoteDueDate: '2025-03-22',
    installDate: '2025-05-28',
    urgency: 'Normal',
    accessInstructions: 'Business hours only, ask for Karen',
    parkingNotes: 'Loading dock on side street',
    siteConditionNotes: 'Open plan office',
    internalNotes: 'Ordered from Luxaflex — ETA 3 weeks',
    createdAt: '2025-03-15T13:00:00.000Z',
    updatedAt: '2025-05-01T11:00:00.000Z',
  },
];

const SEED_MEASURE_SHEETS = [
  {
    id: 'ms-1',
    jobId: 'job-1',
    customerId: 'cust-1',
    status: 'Submitted',
    measureDate: '2025-04-10',
    measurer: 'Alex Chen',
    lineItems: [
      {
        id: 'li-1', location: 'Master Bedroom', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        quantity: 1, widthMm: 3200, dropMm: 2450, fabricColour: 'White Linen Sheer',
        control: 'Left', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling',
        heading: 'Wave Fold', attachedLining: false, liningFabricColour: '',
        hem: 'N/A', trackBaseBarColour: 'Off White', baseBarType: '', chainColour: '', notes: '200% fullness', sortOrder: 0,
      },
      {
        id: 'li-2', location: 'Master Bedroom', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        quantity: 1, widthMm: 3200, dropMm: 2450, fabricColour: 'Midnight Grey',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling',
        heading: '', attachedLining: false, liningFabricColour: '',
        hem: 'Chain Weight', trackBaseBarColour: 'Black', baseBarType: 'D30 Bump', chainColour: 'Black', notes: 'Behind curtain rod', sortOrder: 1,
      },
      {
        id: 'li-3', location: 'Living Room', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        quantity: 1, widthMm: 4800, dropMm: 2700, fabricColour: 'Natural Sheer',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling',
        heading: 'Wave Fold', attachedLining: false, liningFabricColour: '',
        hem: 'N/A', trackBaseBarColour: 'White', baseBarType: '', chainColour: '', notes: 'Floor to ceiling. Double rod for future blockout.', sortOrder: 2,
      },
    ],
    createdAt: '2025-04-10T09:30:00.000Z',
    updatedAt: '2025-04-10T11:00:00.000Z',
  },
  {
    id: 'ms-2',
    jobId: 'job-3',
    customerId: 'cust-3',
    status: 'Submitted',
    measureDate: '2025-04-22',
    measurer: 'Alex Chen',
    lineItems: [
      {
        id: 'li-4', location: 'Bedroom', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        quantity: 2, widthMm: 1800, dropMm: 2100, fabricColour: 'Coastal White',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Reveal',
        heading: '', attachedLining: false, liningFabricColour: '',
        hem: 'Chain Weight', trackBaseBarColour: 'White', baseBarType: 'D30 Bump', chainColour: 'White', notes: '', sortOrder: 0,
      },
      {
        id: 'li-5', location: 'Living Room', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        quantity: 1, widthMm: 3600, dropMm: 2600, fabricColour: 'Silver Sheer',
        control: 'Left', returnSide: 'Left', motorSide: 'Left', fixing: 'Ceiling',
        heading: 'Wave Fold', attachedLining: false, liningFabricColour: '',
        hem: 'N/A', trackBaseBarColour: 'Anodised', baseBarType: '', chainColour: '', notes: 'Motorised. Check wall bracket strength.', sortOrder: 1,
      },
    ],
    createdAt: '2025-04-22T11:30:00.000Z',
    updatedAt: '2025-04-22T13:00:00.000Z',
  },
];

const SEED_ACTIVITY = [
  { id: 'act-1', jobId: 'job-1', type: 'status_change', message: 'Status changed to Quoted', user: 'Alex Chen', createdAt: '2025-04-15T14:30:00.000Z' },
  { id: 'act-2', jobId: 'job-1', type: 'measure_created', message: 'Measure sheet created', user: 'Alex Chen', createdAt: '2025-04-10T09:30:00.000Z' },
  { id: 'act-3', jobId: 'job-3', type: 'status_change', message: 'Status changed to Approved', user: 'Alex Chen', createdAt: '2025-04-28T09:00:00.000Z' },
  { id: 'act-4', jobId: 'job-3', type: 'measure_created', message: 'Measure sheet created', user: 'Alex Chen', createdAt: '2025-04-22T11:30:00.000Z' },
  { id: 'act-5', jobId: 'job-5', type: 'status_change', message: 'Status changed to Ordered', user: 'Sam Russo', createdAt: '2025-05-01T11:00:00.000Z' },
  { id: 'act-6', jobId: 'job-2', type: 'job_created', message: 'Job created', user: 'Jordan Lee', createdAt: '2025-04-20T10:00:00.000Z' },
];

const SEED_STAFF = [
  { id: 'staff-1', name: 'Alex Chen', role: 'Salesperson', email: 'alex@lusso.com.au' },
  { id: 'staff-2', name: 'Jordan Lee', role: 'Measurer', email: 'jordan@lusso.com.au' },
  { id: 'staff-3', name: 'Sam Russo', role: 'Office Staff', email: 'sam@lusso.com.au' },
  { id: 'staff-4', name: 'Mia Torres', role: 'Installer', email: 'mia@lusso.com.au' },
  { id: 'staff-5', name: 'Admin', role: 'Admin', email: 'admin@lusso.com.au' },
];

const SEED_INSTALLERS = [
  {
    id: 'ins-1',
    name: 'Marco Ferretti',
    businessName: 'Ferretti Blinds & Curtains',
    email: 'marco@ferrettiblinds.com.au',
    phone: '0411 222 333',
    serviceAreas: 'Eastern Suburbs, Inner West, CBD',
    servicesOffered: ['Curtain installation', 'Roller blind installation', 'Track installation', 'Warranty work'],
    availabilityNotes: 'Mon–Fri 7am–4pm. Saturdays on request.',
    internalNotes: 'Reliable, quality work. Preferred for premium jobs.',
    isActive: true,
    createdAt: '2025-01-15T09:00:00.000Z',
    updatedAt: '2025-01-15T09:00:00.000Z',
  },
  {
    id: 'ins-2',
    name: 'Dave Nguyen',
    businessName: 'Nguyen Installations',
    email: 'dave@nguyeninstall.com.au',
    phone: '0422 333 444',
    serviceAreas: 'Northern Suburbs, North Shore, Lower North Shore',
    servicesOffered: ['Roller blind installation', 'External blind service', 'Repairs', 'Site inspection'],
    availabilityNotes: 'Mon–Sat, flexible hours.',
    internalNotes: 'Great for blinds. Not experienced with complex curtain tracks.',
    isActive: true,
    createdAt: '2025-02-01T09:00:00.000Z',
    updatedAt: '2025-02-01T09:00:00.000Z',
  },
  {
    id: 'ins-3',
    name: 'Sarah Kowalski',
    businessName: 'SK Install Co.',
    email: 'sarah@skinstall.com.au',
    phone: '0433 444 555',
    serviceAreas: 'South Sydney, Sutherland Shire, St George',
    servicesOffered: ['Curtain installation', 'Shutter installation', 'Track installation', 'Warranty work', 'Repairs'],
    availabilityNotes: 'Tues–Sat only. No Sundays.',
    internalNotes: 'Great attention to detail. Slight premium on pricing.',
    isActive: true,
    createdAt: '2025-03-10T09:00:00.000Z',
    updatedAt: '2025-03-10T09:00:00.000Z',
  },
  {
    id: 'ins-4',
    name: 'Ben Carlisle',
    businessName: 'Carlisle Trade Services',
    email: 'ben@carlisletrade.com.au',
    phone: '0444 555 666',
    serviceAreas: 'Western Suburbs, Hills District, Parramatta',
    servicesOffered: ['Roller blind installation', 'Curtain installation', 'External blind service', 'Remove existing tracks'],
    availabilityNotes: 'Mon–Fri only.',
    internalNotes: 'Currently on reduced capacity — confirm availability before sending.',
    isActive: false,
    createdAt: '2025-04-01T09:00:00.000Z',
    updatedAt: '2025-04-20T09:00:00.000Z',
  },
];

const SEED_INSTALL_REQUESTS = [
  {
    id: 'ireq-1',
    jobId: 'job-3',
    installerId: 'ins-1',
    proposedDate: '2025-05-20',
    arrivalTime: '8:00 AM',
    expectedDuration: '3 hours',
    serviceRequired: 'Install 2 × Blockout Roller Blind, Install 1 × Sheer Curtain',
    productSummary: 'Bedroom: 2× Blockout Roller Blind (1800×2100mm, Recess Fit, Right). Living Room: 1× Sheer Curtain (3600×2600mm, Ceiling Fix, Motorised).',
    siteNotes: 'Buzz unit 3 on intercom',
    parkingNotes: 'Paid parking on Park Street',
    accessNotes: 'Buzz unit 3 on intercom',
    pickupType: 'Pickup from one supplier',
    pickupLocations: [
      {
        id: 'pkl-1',
        locationName: 'Luxaflex Melbourne',
        address: '45 Trade Park Drive, Tullamarine VIC 3043',
        contactPerson: 'Tony Walsh',
        contactPhone: '03 9335 1200',
        pickupDate: '2025-05-19',
        pickupTime: '9:00 AM',
        productsToCollect: '2× Blockout Roller Blind (Coastal White, 1800×2100mm), 1× Motorised Sheer Track',
        orderReference: 'LUX-88231',
        pickupNotes: 'Call ahead — loading dock at rear. Bring trolley.',
      },
    ],
    installationNotes: 'Motorised track requires power point check before install.',
    status: 'Accepted',
    secureAcceptToken: 'tok-accept-ireq-1',
    secureDeclineToken: 'tok-decline-ireq-1',
    sentAt: '2025-05-01T10:00:00.000Z',
    respondedAt: '2025-05-01T14:30:00.000Z',
    responseComment: 'Confirmed. Will bring motorised track hardware.',
    createdBy: 'Alex Chen',
    assignedSalesperson: 'Alex Chen',
    suburb: 'South Yarra',
    revealFullDetails: true,
    createdAt: '2025-05-01T09:00:00.000Z',
    updatedAt: '2025-05-01T14:30:00.000Z',
  },
  {
    id: 'ireq-2',
    jobId: 'job-1',
    installerId: 'ins-1',
    proposedDate: '2025-05-12',
    arrivalTime: '9:00 AM',
    expectedDuration: '4 hours',
    serviceRequired: 'Install 1 × Sheer Curtain, Install 1 × Blockout Roller Blind, Install 1 × Sheer Curtain',
    productSummary: 'Master Bedroom: 1× Sheer Curtain Wave fold (3200×2450mm). Master Bedroom: 1× Blockout Roller Blind (3200×2450mm). Living Room: 1× Sheer Curtain Wave fold (4800×2700mm).',
    siteNotes: 'New plaster — protect floors',
    parkingNotes: 'Street parking on Rosewood Drive',
    accessNotes: 'Key under mat at front door',
    pickupType: 'Pickup from multiple suppliers',
    pickupLocations: [
      {
        id: 'pkl-2',
        locationName: 'Lusso Warehouse',
        address: '12 Commerce Drive, Campbellfield VIC 3061',
        contactPerson: 'Sam Russo',
        contactPhone: '03 9000 1234',
        pickupDate: '2025-05-12',
        pickupTime: '7:30 AM',
        productsToCollect: '1× Blockout Roller Blind (Midnight Grey, 3200×2450mm), track hardware',
        orderReference: 'LUS-WH-0042',
        pickupNotes: 'Items staged near roller door 2. Sign the pickup sheet.',
      },
      {
        id: 'pkl-3',
        locationName: 'Kresta Brighton',
        address: '220 Bay Street, Brighton VIC 3186',
        contactPerson: 'Lisa',
        contactPhone: '03 9592 4400',
        pickupDate: '2025-05-12',
        pickupTime: '8:30 AM',
        productsToCollect: '2× Sheer Curtain panels (Natural Sheer, Wave fold)',
        orderReference: 'KRE-7741',
        pickupNotes: 'Items will be wrapped and ready at front desk.',
      },
    ],
    installationNotes: 'Customer wants wave fold headers only. Double-check rod clearance in Living Room.',
    status: 'Sent',
    secureAcceptToken: 'tok-accept-ireq-2',
    secureDeclineToken: 'tok-decline-ireq-2',
    sentAt: '2025-05-02T09:00:00.000Z',
    respondedAt: null,
    responseComment: '',
    createdBy: 'Alex Chen',
    assignedSalesperson: 'Alex Chen',
    suburb: 'Brighton',
    revealFullDetails: false,
    createdAt: '2025-05-02T09:00:00.000Z',
    updatedAt: '2025-05-02T09:00:00.000Z',
  },
];

const SEED_NOTIFICATIONS = [
  {
    id: 'notif-1',
    jobId: 'job-3',
    installRequestId: 'ireq-1',
    type: 'install_accepted',
    title: 'Installation Accepted',
    message: 'Marco Ferretti accepted the installation for Priya Sharma (LUS-0003) on 20 May 2025.',
    isRead: false,
    createdAt: '2025-05-01T14:30:00.000Z',
  },
];

const SEED_PRODUCT_TYPES = [
  { id: 'pt-1',  name: 'Curtain',              slug: 'curtain',               isActive: true, sortOrder: 1,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-2',  name: 'Roller Blind',          slug: 'roller-blind',          isActive: true, sortOrder: 2,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-3',  name: 'Dual Roller Blind',     slug: 'dual-roller-blind',     isActive: true, sortOrder: 3,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-4',  name: 'Roman Blind',           slug: 'roman-blind',           isActive: true, sortOrder: 4,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-5',  name: 'Venetian Blind',        slug: 'venetian-blind',        isActive: true, sortOrder: 5,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-6',  name: 'Shutter',               slug: 'shutter',               isActive: true, sortOrder: 6,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-7',  name: 'Pleated Blind',         slug: 'pleated-blind',         isActive: true, sortOrder: 7,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-8',  name: 'External Blind',        slug: 'external-blind',        isActive: true, sortOrder: 8,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-9',  name: 'Internal Glidescreen',  slug: 'internal-glidescreen',  isActive: true, sortOrder: 9,  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-10', name: 'Pelmet',                slug: 'pelmet',                isActive: true, sortOrder: 10, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-11', name: 'Cellular Blind',        slug: 'cellular-blind',        isActive: true, sortOrder: 11, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'pt-12', name: 'Awning',                slug: 'awning',                isActive: true, sortOrder: 12, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

const get = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const set = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('lusso:data-changed', { detail: { key } }));
};

// Standard init: only seeds if key is null/undefined (not empty array)
const initIfEmpty = (key, seed) => {
  if (!get(key)) set(key, seed);
};

// Config init: also reseeds if the array is empty (handles Supabase wipe of reference data)
const initConfigTable = (key, seed) => {
  const existing = get(key);
  if (!existing || (Array.isArray(existing) && existing.length === 0)) set(key, seed);
};

export const initStore = () => {
  // When Supabase is configured this is a cloud app — do NOT seed business
  // records with demo data. Real records come from Supabase via hydration.
  // When Supabase is not configured (offline/demo build) use seed data.
  const cloud = Boolean(supabase);
  const empty = [];

  initIfEmpty('lusso_customers',       cloud ? empty : SEED_CUSTOMERS);
  initIfEmpty('lusso_jobs',            cloud ? empty : SEED_JOBS);
  initIfEmpty('lusso_measure_sheets',  cloud ? empty : SEED_MEASURE_SHEETS);
  initIfEmpty('lusso_installers',      cloud ? empty : SEED_INSTALLERS);
  initIfEmpty('lusso_install_requests',cloud ? empty : SEED_INSTALL_REQUESTS);
  initIfEmpty('lusso_staff',           cloud ? empty : SEED_STAFF);
  initIfEmpty('lusso_notifications',   cloud ? empty : SEED_NOTIFICATIONS);

  // Activity log is localStorage-only (not synced to Supabase)
  initIfEmpty('lusso_activity', SEED_ACTIVITY);

  // Job counter — set a safe default (hydration will raise it if Supabase has higher)
  initIfEmpty('lusso_job_counter', 0);

  // Product types: reseed if empty (config data synced from Supabase on hydration)
  initConfigTable('lusso_product_types', cloud ? empty : SEED_PRODUCT_TYPES);

  // Schema v2: new margin-based pricing fields.
  if (localStorage.getItem('lusso_schema_version') !== '2') {
    localStorage.removeItem('lusso_quotes');
    localStorage.removeItem('lusso_saved_items');
    localStorage.removeItem('lusso_quote_counter');
    localStorage.removeItem('lusso_quote_settings');
    localStorage.setItem('lusso_schema_version', '2');
  }

  initIfEmpty('lusso_quotes',          cloud ? empty : SEED_QUOTES);
  initIfEmpty('lusso_quote_counter',   0);
  initIfEmpty('lusso_saved_items',     cloud ? empty : SEED_SAVED_ITEMS);
  initIfEmpty('lusso_quote_templates', cloud ? empty : SEED_QUOTE_TEMPLATES);
  initIfEmpty('lusso_quote_settings',  DEFAULT_QUOTE_SETTINGS);
  initIfEmpty('lusso_employees',       cloud ? empty : SEED_EMPLOYEES);
  initIfEmpty('lusso_tasks',           cloud ? empty : SEED_TASKS);
  initIfEmpty('lusso_calendar_events', empty); // always empty — user-created only
};

// ─── Customers ────────────────────────────────────────────────────────────────

export const getCustomers = () => (get('lusso_customers') || []).filter(c => !c.deletedAt);

export const restoreCustomer = async (id) => {
  // First restore locally if the record is still in localStorage
  const all = get('lusso_customers') || [];
  const idx = all.findIndex(c => c.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], deletedAt: null };
    set('lusso_customers', all);
  }

  // Clear deleted_at in Supabase (await so hydration gets the clean record)
  await db.restoreCustomer(id);

  // Re-hydrate customers from Supabase — this brings the record back even if
  // it was removed from localStorage by a previous hydration cycle
  await hydrateFromSupabase();

  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
};

export const deleteCustomer = (id, deletedBy = 'Admin') => {
  const all = get('lusso_customers') || [];
  const idx = all.findIndex(c => c.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], deletedAt: now, deletedBy, updatedAt: now };
  set('lusso_customers', all);
  // Hard-delete from Supabase — fires Realtime DELETE event on all other devices instantly.
  // The local soft-delete above keeps the record hidden on this device until next reload.
  db.deleteCustomer(id);
};

export const bulkDeleteCustomers = (ids, deletedBy = 'Admin') => {
  ids.forEach(id => deleteCustomer(id, deletedBy));
};

export const getCustomer = (id) => (get('lusso_customers') || []).find(c => c.id === id);

export const findOrCreateCustomer = (data) => {
  const customers = getCustomers();
  const existing = customers.find(c =>
    (data.email && c.email && c.email.toLowerCase() === data.email.toLowerCase()) ||
    (data.phone && c.phone && c.phone.replace(/\s/g, '') === data.phone.replace(/\s/g, '')) ||
    (data.address && c.address && c.address.toLowerCase() === data.address.toLowerCase())
  );
  if (existing) {
    // Update if new info
    const updated = { ...existing, ...data, id: existing.id, updatedAt: new Date().toISOString() };
    saveCustomer(updated);
    return updated;
  }
  const customer = {
    id: uuidv4(),
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  set('lusso_customers', [...customers, customer]);
  db.saveCustomer(customer);
  return customer;
};

export const saveCustomer = (customer) => {
  const customers = getCustomers();
  const idx = customers.findIndex(c => c.id === customer.id);
  if (idx >= 0) {
    customers[idx] = { ...customer, updatedAt: new Date().toISOString() };
  } else {
    customers.push({ ...customer, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  set('lusso_customers', customers);
  db.saveCustomer(customers[customers.findIndex(c => c.id === customer.id)]);
};

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const getJobs = () => (get('lusso_jobs') || []).filter(j => !j.deletedAt);

export const deleteJob = (id, deletedBy = 'Admin') => {
  const all = get('lusso_jobs') || [];
  const idx = all.findIndex(j => j.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();

  // ── Delete children from Supabase BEFORE the job ─────────────────────
  // FK constraints would block the job DELETE if children still exist.
  // Deleting children first also fires Realtime DELETE events on other devices.

  // Measure sheets → cascade delete from Supabase, remove from local
  const allSheets = get('lusso_measure_sheets') || [];
  const linkedSheets = allSheets.filter(s => s.jobId === id);
  linkedSheets.forEach(s => db.deleteMeasureSheet(s.id));
  set('lusso_measure_sheets', allSheets.filter(s => s.jobId !== id));

  // Quotes → unlink locally (DB FK ON DELETE SET NULL handles the DB side automatically)
  // Quotes are financial records — never delete them when a job is deleted.
  const allQuotes = get('lusso_quotes') || [];
  const updatedQuotes = allQuotes.map(q =>
    q.jobId === id && !q.deletedAt ? { ...q, jobId: null, updatedAt: now } : q
  );
  set('lusso_quotes', updatedQuotes);

  // Install requests → delete from Supabase and local
  const reqs = get('lusso_install_requests') || [];
  const linkedReqs = reqs.filter(r => r.jobId === id);
  linkedReqs.forEach(r => db.deleteInstallRequest(r.id));
  set('lusso_install_requests', reqs.filter(r => r.jobId !== id));

  // ── Soft-delete the job locally ───────────────────────────────────────
  all[idx] = { ...all[idx], deletedAt: now, deletedBy, updatedAt: now };
  set('lusso_jobs', all);

  // ── Hard-delete the job from Supabase ─────────────────────────────────
  // Children are already gone so FK constraints won't block this.
  db.deleteJob(id);
};

export const bulkDeleteJobs = (ids, deletedBy = 'Admin') => {
  ids.forEach(id => deleteJob(id, deletedBy));
};

export const getJob = (id) => (get('lusso_jobs') || []).find(j => j.id === id);

export const getJobsByCustomer = (customerId) => getJobs().filter(j => j.customerId === customerId);

export const nextJobNumber = () => {
  const n = (get('lusso_job_counter') || 0) + 1;
  set('lusso_job_counter', n);
  return `LUS-${String(n).padStart(4, '0')}`;
};

export const saveJob = (job) => {
  const jobs = getJobs();
  const idx = jobs.findIndex(j => j.id === job.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    jobs[idx] = { ...job, updatedAt: now };
  } else {
    jobs.push({ ...job, createdAt: now, updatedAt: now });
  }
  set('lusso_jobs', jobs);
  db.saveJob(jobs[jobs.findIndex(j => j.id === job.id)]);
};

export const createJob = (data) => {
  const id = uuidv4();
  const job = {
    id,
    customerId: data.customerId,
    jobNumber: nextJobNumber(),
    title: data.title || '',
    status: 'New Enquiry',
    jobType: data.jobType || '',
    assignedStaff: data.assignedStaff || '',
    urgency: data.urgency || 'Normal',
    measureDate: data.measureDate || null,
    quoteDueDate: data.quoteDueDate || null,
    installDate: data.installDate || null,
    siteAddress: data.siteAddress || '',
    accessInstructions: data.accessInstructions || '',
    parkingNotes: data.parkingNotes || '',
    siteConditionNotes: data.siteConditionNotes || '',
    internalNotes: data.internalNotes || '',
  };
  saveJob(job);
  addActivity({ jobId: id, type: 'job_created', message: 'Job created', user: data.createdBy || 'Admin' });
  return job;
};

export const createJobFromMeasureSheet = (measureSheet, customer) => {
  const job = {
    id: uuidv4(),
    customerId: customer.id,
    jobNumber: nextJobNumber(),
    title: `${customer.name} – ${measureSheet.jobType || 'Window Treatment'}`,
    status: 'Measured',
    jobType: measureSheet.jobType || '',
    assignedStaff: measureSheet.measurer || '',
    measureDate: measureSheet.measureDate || null,
    quoteDueDate: null,
    installDate: null,
    urgency: measureSheet.urgency || 'Normal',
    accessInstructions: measureSheet.accessInstructions || '',
    parkingNotes: measureSheet.parkingNotes || '',
    siteConditionNotes: measureSheet.siteConditionNotes || '',
    internalNotes: measureSheet.internalNotes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveJob(job);
  addActivity({ jobId: job.id, type: 'job_created', message: 'Job created from measure sheet', user: measureSheet.measurer || 'System' });
  addActivity({ jobId: job.id, type: 'measure_created', message: 'Measure sheet submitted', user: measureSheet.measurer || 'System' });
  return job;
};

export const updateJobStatus = (jobId, newStatus, user = 'System') => {
  const jobs = getJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], status: newStatus, updatedAt: new Date().toISOString() };
  set('lusso_jobs', jobs);
  db.saveJob(jobs[idx]);
  addActivity({ jobId, type: 'status_change', message: `Status changed to ${newStatus}`, user });
};

// ─── Measure Sheets ───────────────────────────────────────────────────────────

export const getMeasureSheets = () => (get('lusso_measure_sheets') || []).filter(ms => !ms.deletedAt);

// ── Role-filtered getters ──────────────────────────────────────────────────────
export const getJobsFiltered          = (isAM, name) => getJobs().filter(j => isAM || j.assignedStaff === name);
export const getCustomersFiltered     = (isAM, name) => getCustomers().filter(c => isAM || !c.assignedTo || c.assignedTo === name);
export const getQuotesFiltered        = (isAM, name) => (getQuotes() || []).filter(q => !q.deletedAt && (isAM || q.salesperson === name));
export const getMeasureSheetsFiltered = (isAM, name) => getMeasureSheets().filter(ms => isAM || ms.measurer === name);

export const getMeasureSheet = (id) => (get('lusso_measure_sheets') || []).find(ms => ms.id === id);

export const getMeasureSheetByJob        = (jobId) => getMeasureSheets().find(ms => ms.jobId === jobId);
export const getMeasureSheetsByJob       = (jobId) => getMeasureSheets().filter(ms => ms.jobId === jobId);
export const getMeasureSheetsByCustomer  = (customerId) => getMeasureSheets().filter(ms => ms.customerId === customerId);

export const deleteMeasureSheet = (id, deletedBy = 'Admin') => {
  const all = get('lusso_measure_sheets') || [];
  const idx = all.findIndex(ms => ms.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], deletedAt: now, deletedBy, updatedAt: now };
  set('lusso_measure_sheets', all);
  // Hard-delete from Supabase — fires Realtime DELETE event on all other devices instantly.
  db.deleteMeasureSheet(id);
};

export const bulkDeleteMeasureSheets = (ids, deletedBy = 'Admin') => {
  ids.forEach(id => deleteMeasureSheet(id, deletedBy));
};

export const saveMeasureSheet = (sheet) => {
  const sheets = getMeasureSheets();
  const idx = sheets.findIndex(s => s.id === sheet.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    sheets[idx] = { ...sheet, createdAt: sheet.createdAt || now, updatedAt: now };
  } else {
    sheets.push({ ...sheet, createdAt: sheet.createdAt || now, updatedAt: now });
  }
  set('lusso_measure_sheets', sheets);
  db.saveMeasureSheet(sheets[sheets.findIndex(s => s.id === sheet.id)]);
};

// ─── Activity ─────────────────────────────────────────────────────────────────

export const getActivity = () => get('lusso_activity') || [];

export const getActivityByJob = (jobId) => getActivity().filter(a => a.jobId === jobId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

export const addActivity = ({ jobId, type, message, user }) => {
  const now = new Date().toISOString();
  const entry = { id: uuidv4(), jobId, type, message, user, createdAt: now, updatedAt: now };
  const activity = getActivity();
  activity.unshift(entry);
  set('lusso_activity', activity);
  db.saveActivity(entry); // sync to Supabase (append-only)
};

// ─── PO message presets (email → pre-written message) ─────────────────────────
export const getPoPresets = () =>
  (get('lusso_po_message_presets') || []).filter(p => !p.deletedAt);

export const getPoPresetForEmail = (email) => {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return getPoPresets().find(p => (p.email || '').trim().toLowerCase() === e) || null;
};

// Upsert a preset (one per email). Returns the saved record.
export const savePoPreset = ({ id, email, message }) => {
  const presets = get('lusso_po_message_presets') || [];
  const now = new Date().toISOString();
  const trimmedEmail = (email || '').trim();
  let idx = id ? presets.findIndex(p => p.id === id) : -1;
  if (idx < 0) idx = presets.findIndex(p => !p.deletedAt && (p.email || '').trim().toLowerCase() === trimmedEmail.toLowerCase());
  let record;
  if (idx >= 0) {
    record = { ...presets[idx], email: trimmedEmail, message, deletedAt: null, updatedAt: now };
    presets[idx] = record;
  } else {
    record = { id: uuidv4(), email: trimmedEmail, message, createdAt: now, updatedAt: now };
    presets.push(record);
  }
  set('lusso_po_message_presets', presets);
  db.savePoMessagePreset(record);
  return record;
};

export const deletePoPreset = (id) => {
  const presets = get('lusso_po_message_presets') || [];
  const idx = presets.findIndex(p => p.id === id);
  if (idx < 0) return;
  presets[idx] = { ...presets[idx], deletedAt: new Date().toISOString() };
  set('lusso_po_message_presets', presets);
  db.deletePoMessagePreset(id);
};

// ─── Suppliers (saved supplier list for purchase orders) ──────────────────────
export const getSuppliers = () =>
  (get('lusso_suppliers') || [])
    .filter(s => !s.deletedAt)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

// Upsert a supplier (one per name). Returns the saved record.
export const saveSupplier = ({ id, name, email }) => {
  const suppliers = get('lusso_suppliers') || [];
  const now = new Date().toISOString();
  const trimmedName = (name || '').trim();
  let idx = id ? suppliers.findIndex(s => s.id === id) : -1;
  if (idx < 0) idx = suppliers.findIndex(s => !s.deletedAt && (s.name || '').trim().toLowerCase() === trimmedName.toLowerCase());
  let record;
  if (idx >= 0) {
    record = { ...suppliers[idx], name: trimmedName, email: (email || '').trim(), deletedAt: null, updatedAt: now };
    suppliers[idx] = record;
  } else {
    record = { id: uuidv4(), name: trimmedName, email: (email || '').trim(), createdAt: now, updatedAt: now };
    suppliers.push(record);
  }
  set('lusso_suppliers', suppliers);
  db.saveSupplier(record);
  return record;
};

export const deleteSupplier = (id) => {
  const suppliers = get('lusso_suppliers') || [];
  const idx = suppliers.findIndex(s => s.id === id);
  if (idx < 0) return;
  suppliers[idx] = { ...suppliers[idx], deletedAt: new Date().toISOString() };
  set('lusso_suppliers', suppliers);
  db.deleteSupplier(id);
};

// ─── Staff ────────────────────────────────────────────────────────────────────

export const getStaff = () => get('lusso_staff') || [];

// ─── Calendar Events ──────────────────────────────────────────────────────────

export const getCalendarEvents = () =>
  (get('lusso_calendar_events') || []).filter(e => !e.isDeleted);

export const getCalendarEvent = (id) =>
  (get('lusso_calendar_events') || []).find(e => e.id === id);

export const getCalendarEventsByJob = (jobId) =>
  getCalendarEvents().filter(e => e.jobId === jobId).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

export const getCalendarEventsByCustomer = (customerId) =>
  getCalendarEvents().filter(e => e.customerId === customerId).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

export const saveCalendarEvent = (event, actorName = 'System') => {
  const all = get('lusso_calendar_events') || [];
  const idx = all.findIndex(e => e.id === event.id);
  const now = new Date().toISOString();
  let isNew = false;
  let record;
  if (idx >= 0) {
    record = { ...all[idx], ...event, updatedAt: now };
    all[idx] = record;
  } else {
    isNew = true;
    record = { ...event, createdAt: now, updatedAt: now };
    all.push(record);
  }
  set('lusso_calendar_events', all);
  db.saveCalendarEvent(record);

  // Write activity log when linked to a job
  if (event.jobId) {
    addActivity({
      jobId: event.jobId,
      type: isNew ? 'calendar_event_created' : 'calendar_event_updated',
      message: isNew
        ? `Calendar entry created: ${event.title || event.eventType}`
        : `Calendar entry updated: ${event.title || event.eventType}`,
      user: actorName,
    });
  }
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
  return record;
};

export const deleteCalendarEvent = (id, deletedBy = 'System') => {
  const all = get('lusso_calendar_events') || [];
  const idx = all.findIndex(e => e.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  const record = { ...all[idx], isDeleted: true, deletedAt: now, deletedBy, updatedAt: now };
  all[idx] = record;
  set('lusso_calendar_events', all);
  // Hard-delete from Supabase — fires Realtime DELETE event on all other devices instantly.
  db.deleteCalendarEvent(id);
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const JOB_STATUSES = [
  'New Enquiry',
  'Measure Booked',
  'Measured',
  'Quote Required',
  'Quoted',
  'Awaiting Approval',
  'Approved',
  'Ordered',
  'Received',
  'Installation Booked',
  'Installed',
  'Completed',
  'Cancelled',
];

export const STATUS_COLORS = {
  'New Enquiry':        'bg-slate-100 text-slate-700',
  'Measure Booked':     'bg-blue-100 text-blue-700',
  'Measured':           'bg-cyan-100 text-cyan-700',
  'Quote Required':     'bg-yellow-100 text-yellow-700',
  'Quoted':             'bg-orange-100 text-orange-700',
  'Awaiting Approval':  'bg-amber-100 text-amber-700',
  'Approved':           'bg-lime-100 text-lime-700',
  'Ordered':            'bg-purple-100 text-purple-700',
  'Received':           'bg-violet-100 text-violet-700',
  'Installation Booked':'bg-indigo-100 text-indigo-700',
  'Installed':          'bg-teal-100 text-teal-700',
  'Completed':          'bg-green-100 text-green-700',
  'Cancelled':          'bg-red-100 text-red-700',
};

export const PRODUCT_TYPES = [
  'Curtain', 'Roller Blind', 'Dual Roller Blind', 'Roman Blind', 'Venetian Blind',
  'Shutter', 'Pleated Blind', 'External Blind', 'Internal Glidescreen',
  'Pelmet', 'Cellular Blind', 'Awning',
];

export const CONTROL_OPTIONS       = ['Left', 'Right', 'RHS', 'LHS', 'C/O', 'C/O-FR', 'FR'];
export const RETURN_OPTIONS        = ['Left', 'Right', 'L/R', 'N/A'];
export const MOTOR_SIDE_OPTIONS    = ['Left', 'Right', 'N/A'];
export const FIXING_OPTIONS        = ['Ceiling', 'Face', 'Reveal'];
export const HEADING_OPTIONS       = ['Reverse Roll', 'Standard Roll', 'Wave Fold', 'Reverse Pleat', 'Gathered', 'Knife Pleat', 'Double Pinch Pleat', 'Triple Pinch Pleat'];
export const HEM_OPTIONS           = ['Chain Weight', 'Standard', 'Double 7', 'N/A'];
export const TRACK_COLOUR_OPTIONS  = ['White', 'Black', 'Birch White', 'Other'];
export const BASE_BAR_COLOUR_OPTIONS = [
  'NEW Textured White', 'NEW Textured Black', 'Anodised Clear',
  'White', 'Black', 'SandStone', 'Barley', 'Bone', 'Dune', 'Bronze Pearl', 'Other',
];
export const OPERATION_TYPE_OPTIONS = [
  'Li-ion Motor 1.1',
  'Li-ion Motor 2.0',
  'Li-ion Motor 3.0',
  'E6 ARC 240 RTS',
  'M6 - 240 WT',
  'Cherubini 240v',
  'CRM01',
  'Bendable track',
  'Fineline',
  'KAW',
  'MKH',
  'Dual KAW',
  'Dual MKH',
  'MKH and KAW',
  'Oslo 84 (240v)',
  'Oslo 84 (Manual)',
  'Oslo 83 (Battery)',
  'Oslo 70 (Recess)',
  'No tracks',
  'RB09',
];
export const BASE_BAR_TYPE_OPTIONS = ['Oval', 'D30 Bump', 'Smart Rail Fabric Wrap – FULL', 'Smart Rail Fabric Wrap – HALF', 'Smart Rail', 'Other'];
export const CHAIN_COLOUR_OPTIONS  = ['Black', 'White', 'Grey', 'Stainless'];

export const MOUNT_TYPES = ['Ceiling Fix', 'Face Fix', 'Recess Fit', 'Outside Mount', 'Inside Mount'];
export const CONTROL_SIDES = ['Left', 'Right', 'Centre', 'Motorised', 'N/A'];
export const URGENCY_LEVELS = ['Low', 'Normal', 'High', 'Urgent'];
export const JOB_TYPES = [
  'Roller Blinds', 'Roman Blinds', 'Curtains & Blinds', 'Sheers & Blockout',
  'Awnings', 'Shutters', 'Commercial Blinds', 'Full Window Treatment', 'Other',
];

// ─── Installers ───────────────────────────────────────────────────────────────

export const INSTALLER_SERVICES = [
  'Curtain installation', 'Roller blind installation', 'External blind service',
  'Shutter installation', 'Track installation', 'Warranty work',
  'Site inspection', 'Repairs', 'Remove existing tracks',
  'Install ceiling-mounted curtain tracks', 'Motorised system installation',
];

export const ARRIVAL_TIMES = [
  '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM',
  '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM',
  '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM',
  '4:00 PM', 'Flexible – TBC',
];

export const DURATION_OPTIONS = [
  '30 minutes', '1 hour', '1.5 hours', '2 hours', '2.5 hours', '3 hours',
  '3.5 hours', '4 hours', '5 hours', '6 hours', 'Full day', 'Multi-day – TBC',
];

export const PICKUP_TYPES = [
  'No pickup required',
  'Pickup from Lusso warehouse',
  'Pickup from one supplier',
  'Pickup from multiple suppliers',
  'Products already onsite',
  'Service-only job',
];

export const INSTALL_REQUEST_STATUSES = [
  'Draft', 'Sent', 'Accepted', 'Declined', 'Cancelled', 'Expired', 'Rescheduled', 'Completed',
];

export const INSTALL_REQUEST_STATUS_COLORS = {
  Draft:       'bg-slate-100 text-slate-600',
  Sent:        'bg-blue-100 text-blue-700',
  Accepted:    'bg-green-100 text-green-700',
  Declined:    'bg-red-100 text-red-700',
  Cancelled:   'bg-slate-100 text-slate-500',
  Expired:     'bg-orange-100 text-orange-700',
  Rescheduled: 'bg-amber-100 text-amber-700',
  Completed:   'bg-teal-100 text-teal-700',
};

export const getInstallers = () => (get('lusso_installers') || []).filter(i => !i.deletedAt);

export const deleteInstaller = (id, deletedBy = 'Admin') => {
  const all = get('lusso_installers') || [];
  const idx = all.findIndex(i => i.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], deletedAt: now, deletedBy, updatedAt: now };
  set('lusso_installers', all);
  // Hard-delete from Supabase — fires Realtime DELETE event on all other devices instantly.
  db.deleteInstaller(id);
};

export const bulkDeleteInstallers = (ids, deletedBy = 'Admin') => {
  ids.forEach(id => deleteInstaller(id, deletedBy));
};
export const getInstaller = (id) => (get('lusso_installers') || []).find(i => i.id === id);
export const getActiveInstallers = () => getInstallers().filter(i => i.isActive);

export const saveInstaller = (installer) => {
  const list = getInstallers();
  const idx = list.findIndex(i => i.id === installer.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...installer, updatedAt: now };
  } else {
    list.push({ ...installer, id: installer.id || uuidv4(), createdAt: now, updatedAt: now });
  }
  set('lusso_installers', list);
  db.saveInstaller(list[list.findIndex(i => i.id === installer.id)]);
};

// ─── Installation Requests ────────────────────────────────────────────────────

export const getInstallRequests = () => (get('lusso_install_requests') || []).filter(r => !r.deletedAt);
export const getInstallRequest = (id) => getInstallRequests().find(r => r.id === id);
export const getInstallRequestsByJob = (jobId) => getInstallRequests().filter(r => r.jobId === jobId);
export const getInstallRequestsByInstaller = (installerId) => getInstallRequests().filter(r => r.installerId === installerId);

export const getInstallRequestByToken = (token) => {
  const all = getInstallRequests();
  return all.find(r => r.secureAcceptToken === token || r.secureDeclineToken === token) || null;
};

export const saveInstallRequest = (req) => {
  const list = getInstallRequests();
  const idx = list.findIndex(r => r.id === req.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...req, updatedAt: now };
  } else {
    list.push({ ...req, createdAt: now, updatedAt: now });
  }
  set('lusso_install_requests', list);
  db.saveInstallRequest(req);
};

export const createInstallRequest = (data) => {
  const id = uuidv4();
  const req = {
    id,
    ...data,
    status: 'Draft',
    secureAcceptToken: `tok-accept-${id}`,
    secureDeclineToken: `tok-decline-${id}`,
    sentAt: null,
    respondedAt: null,
    responseComment: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveInstallRequest(req);
  addActivity({ jobId: data.jobId, type: 'install_request_created', message: 'Installation request created', user: data.createdBy || 'System' });
  return req;
};

export const sendInstallRequest = (reqId, user = 'System') => {
  const list = getInstallRequests();
  const idx = list.findIndex(r => r.id === reqId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  list[idx] = { ...list[idx], status: 'Sent', sentAt: now, updatedAt: now };
  set('lusso_install_requests', list);
  addActivity({ jobId: list[idx].jobId, type: 'install_request_sent', message: `Installation request sent to ${getInstaller(list[idx].installerId)?.name || 'installer'}`, user });
  return list[idx];
};

export const respondToInstallRequest = (token, action, comment = '') => {
  // action: 'accept' | 'decline'
  const list = getInstallRequests();
  const idx = list.findIndex(r => r.secureAcceptToken === token || r.secureDeclineToken === token);
  if (idx < 0) return null;
  const req = list[idx];
  if (req.status === 'Accepted' || req.status === 'Declined') return req; // already responded

  const isAccept = action === 'accept';
  const now = new Date().toISOString();
  const newStatus = isAccept ? 'Accepted' : 'Declined';

  list[idx] = { ...req, status: newStatus, respondedAt: now, responseComment: comment, updatedAt: now };
  set('lusso_install_requests', list);
  // Sync response to Supabase so all devices see the updated status immediately.
  db.saveInstallRequest(list[idx]);

  // Update job status if accepted
  if (isAccept) {
    updateJobStatus(req.jobId, 'Installation Booked', 'Installer Portal');
  }

  // Add activity
  const installer = getInstaller(req.installerId);
  addActivity({
    jobId: req.jobId,
    type: isAccept ? 'install_accepted' : 'install_declined',
    message: `${installer?.name || 'Installer'} ${isAccept ? 'accepted' : 'declined'} the installation request`,
    user: installer?.name || 'Installer',
  });

  // Add notification
  const job = getJob(req.jobId);
  const customer = job ? getCustomer(job.customerId) : null;
  addNotification({
    jobId: req.jobId,
    installRequestId: req.id,
    type: isAccept ? 'install_accepted' : 'install_declined',
    title: isAccept ? 'Installation Accepted' : 'Installation Declined',
    message: `${installer?.name || 'Installer'} ${isAccept ? 'accepted' : 'declined'} the installation for ${customer?.name || 'customer'} (${job?.jobNumber || ''}) on ${req.proposedDate}.${comment ? ' Comment: ' + comment : ''}`,
  });

  return list[idx];
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const getNotifications = () => get('lusso_notifications') || [];
export const getUnreadNotifications = () => getNotifications().filter(n => !n.isRead);

export const addNotification = ({ jobId, installRequestId, type, title, message }) => {
  const list = getNotifications();
  list.unshift({
    id: uuidv4(),
    jobId,
    installRequestId,
    type,
    title,
    message,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  set('lusso_notifications', list);
  db.saveNotification(list[0]);
};

export const markNotificationRead = (id) => {
  const list = getNotifications();
  const idx = list.findIndex(n => n.id === id);
  if (idx >= 0) list[idx].isRead = true;
  set('lusso_notifications', list);
};

export const markAllNotificationsRead = () => {
  const list = getNotifications().map(n => ({ ...n, isRead: true }));
  set('lusso_notifications', list);
};

// ─── Product Types ────────────────────────────────────────────────────────────

export const getProductTypes = () => (get('lusso_product_types') || []).sort((a, b) => a.sortOrder - b.sortOrder);
export const getActiveProductTypes = () => getProductTypes().filter(p => p.isActive);

export const saveProductType = (pt) => {
  const list = getProductTypes();
  const idx = list.findIndex(p => p.id === pt.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = { ...pt, updatedAt: now };
  } else {
    list.push({ ...pt, id: pt.id || uuidv4(), createdAt: now, updatedAt: now });
  }
  set('lusso_product_types', list);
  db.saveProductType(list[list.findIndex(p => p.id === pt.id)]);
};

export const addProductType = (name) => {
  const list = getProductTypes();
  const maxOrder = list.reduce((m, p) => Math.max(m, p.sortOrder), 0);
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const pt = {
    id: uuidv4(),
    name,
    slug,
    isActive: true,
    sortOrder: maxOrder + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  set('lusso_product_types', [...list, pt]);
  db.saveProductType(pt);
  return pt;
};

export const reorderProductType = (id, direction) => {
  // direction: 'up' | 'down'
  const list = getProductTypes(); // already sorted by sortOrder
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  const now = new Date().toISOString();
  const tempOrder = list[idx].sortOrder;
  list[idx] = { ...list[idx], sortOrder: list[swapIdx].sortOrder, updatedAt: now };
  list[swapIdx] = { ...list[swapIdx], sortOrder: tempOrder, updatedAt: now };
  set('lusso_product_types', list);
  db.saveProductType(list[idx]);
  db.saveProductType(list[swapIdx]);
};

// ─── Quotes ───────────────────────────────────────────────────────────────────

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Waiting', 'Accepted', 'Declined', 'Expired', 'Completed'];

export const QUOTE_STATUS_COLORS = {
  Draft:     'bg-slate-100 text-slate-600',
  Sent:      'bg-blue-100 text-blue-700',
  Viewed:    'bg-cyan-100 text-cyan-700',
  Waiting:   'bg-amber-100 text-amber-700',
  Accepted:  'bg-green-100 text-green-700',
  Declined:  'bg-red-100 text-red-700',
  Expired:   'bg-orange-100 text-orange-700',
  Completed: 'bg-teal-100 text-teal-700',
};

export const QUOTE_ITEM_TYPES = ['Required', 'Optional', 'Multiple Choice', 'Part'];
export const DEPOSIT_TYPES    = ['None', 'Fixed Amount', 'Percentage'];

/**
 * New margin-based pricing model.
 * sell = (unitCostPrice + labourCost) / (1 - marginPercent / 100)
 * If manualSellPrice is set (non-empty), it overrides the calculated sell price.
 * Returns per-unit figures plus lineTotal (finalSell × quantity).
 */
export const calcItemPricing = (unitCostPrice, labourCost, marginPercent, manualSellPrice, quantity = 1) => {
  const cost      = Number(unitCostPrice) || 0;
  const labour    = Number(labourCost)    || 0;
  const margin    = Number(marginPercent) || 0;
  const totalCost = cost + labour;
  const calcSell  = margin < 100 ? totalCost / (1 - margin / 100) : totalCost;
  const hasManual = manualSellPrice !== '' && manualSellPrice !== null && manualSellPrice !== undefined;
  const finalSell = hasManual ? Number(manualSellPrice) : calcSell;
  const grossProfit = finalSell - totalCost;
  const gpPercent   = finalSell > 0 ? (grossProfit / finalSell * 100) : 0;
  const lineTotal   = finalSell * (Number(quantity) || 1);
  return { totalCost, calcSell, finalSell, grossProfit, gpPercent, lineTotal };
};

export const computeQuoteTotals = (lineItems = [], depositType = 'None', depositValue = 0, gstRate = 10, includesGST = true, selectedIds = []) => {
  const active = lineItems.filter(li =>
    li.type === 'Required' ||
    li.type === 'Part' ||
    (li.type === 'Optional' && selectedIds.includes(li.id)) ||
    (li.type === 'Multiple Choice' && selectedIds.includes(li.id))
  );
  const subtotal = active.reduce((s, li) => {
    // New pricing model (has unitCostPrice field)
    if (li.unitCostPrice !== undefined) {
      const { lineTotal } = calcItemPricing(li.unitCostPrice, li.labourCost, li.marginPercent, li.manualSellPrice, li.quantity);
      return s + lineTotal;
    }
    // Legacy fallback (old unitPrice + labourCost model)
    return s + ((Number(li.unitPrice) || 0) + (Number(li.labourCost) || 0)) * (Number(li.quantity) || 1);
  }, 0);
  const gst      = includesGST ? subtotal * (gstRate / 100) : 0;
  const total    = subtotal + gst;
  const deposit  = depositType === 'Percentage' ? total * (depositValue / 100)
                 : depositType === 'Fixed Amount' ? Number(depositValue)
                 : 0;
  return { subtotal, gst, total, deposit };
};

const SEED_QUOTES = [
  {
    id: 'qt-1',
    quoteNumber: 'QT-0001',
    version: 1,
    title: 'Brighton Residence – Full Window Treatment',
    status: 'Sent',
    customerId: 'cust-1',
    jobId: 'job-1',
    measureSheetId: 'ms-1',
    siteAddress: '14 Rosewood Drive, Brighton VIC 3186',
    introMessage: 'Thank you for the opportunity to quote on your window furnishings. Please find our detailed proposal below. We look forward to transforming your home.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due on completion. Lead time is approximately 4–6 weeks from order. All products are custom-made and non-refundable.',
    internalNotes: 'Customer wants premium fabrics only. Check Acmeda stock for Wave Fold track.',
    salesperson: 'Alex Chen',
    expiryDate: '2025-05-17',
    followUpDate: '2025-05-10',
    depositType: 'Percentage',
    depositValue: 50,
    includesGST: true,
    gstRate: 10,
    showSizesToClient: false,
    sentAt: '2025-04-18T09:00:00.000Z',
    viewedAt: '2025-04-18T14:23:00.000Z',
    acceptedAt: null,
    declinedAt: null,
    acceptedBy: null,
    lineItems: [
      {
        id: 'qli-1', type: 'Required', choiceGroupId: null,
        location: 'Master Bedroom', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        description: 'White Linen Sheer curtain with Wave Fold heading, ceiling fix',
        quantity: 1, widthMm: 3200, dropMm: 2450, fabricColour: 'White Linen Sheer',
        control: 'Left', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: 'Wave Fold',
        trackBaseBarColour: 'Off White', baseBarType: '', chainColour: '',
        unitCostPrice: 650, labourCost: 180, marginPercent: 40, manualSellPrice: 1630, supplier: 'Acmeda', taxable: true,
        customerNotes: '200% fullness. Custom track length.', internalNotes: 'Order from Acmeda – check lead time', sortOrder: 0,
      },
      {
        id: 'qli-2', type: 'Required', choiceGroupId: null,
        location: 'Master Bedroom', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        description: 'Midnight Grey blockout roller blind with D30 Bump base bar',
        quantity: 1, widthMm: 3200, dropMm: 2450, fabricColour: 'Midnight Grey',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: '',
        trackBaseBarColour: 'Black', baseBarType: 'D30 Bump', chainColour: 'Black',
        unitCostPrice: 380, labourCost: 120, marginPercent: 40, manualSellPrice: 1010, supplier: 'Luxaflex', taxable: true,
        customerNotes: 'Behind curtain rod.', internalNotes: '', sortOrder: 1,
      },
      {
        id: 'qli-3', type: 'Required', choiceGroupId: null,
        location: 'Living Room', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        description: 'Natural Sheer curtain with Wave Fold heading, floor to ceiling',
        quantity: 1, widthMm: 4800, dropMm: 2700, fabricColour: 'Natural Sheer',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: 'Wave Fold',
        trackBaseBarColour: 'White', baseBarType: '', chainColour: '',
        unitCostPrice: 880, labourCost: 220, marginPercent: 40, manualSellPrice: 2200, supplier: 'Acmeda', taxable: true,
        customerNotes: 'Floor to ceiling. Double rod prepared for future blockout.', internalNotes: 'Quote double rod as optional upgrade', sortOrder: 2,
      },
      {
        id: 'qli-4', type: 'Optional', choiceGroupId: null,
        location: 'Living Room', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        description: 'Future blockout roller blind upgrade – Living Room',
        quantity: 1, widthMm: 4800, dropMm: 2700, fabricColour: 'Arctic White Blockout',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: '',
        trackBaseBarColour: 'White', baseBarType: 'D30 Bump', chainColour: 'White',
        unitCostPrice: 480, labourCost: 150, marginPercent: 40, manualSellPrice: 1250, supplier: 'Luxaflex', taxable: true,
        customerNotes: 'Optional upgrade – add blockout blind behind sheer curtain.', internalNotes: '', sortOrder: 3,
      },
    ],
    activity: [
      { id: 'qa-1', type: 'created',  note: 'Quote created',                       user: 'Alex Chen',  createdAt: '2025-04-15T10:00:00.000Z' },
      { id: 'qa-2', type: 'sent',     note: 'Quote sent to customer via email',     user: 'Alex Chen',  createdAt: '2025-04-18T09:00:00.000Z' },
      { id: 'qa-3', type: 'viewed',   note: 'Customer opened the quote',            user: 'Customer',   createdAt: '2025-04-18T14:23:00.000Z' },
    ],
    comments: [
      { id: 'qc-1', type: 'customer', author: 'Sarah Mitchell', message: 'Could you also include a motorised option for the Living Room curtain?', createdAt: '2025-04-19T10:00:00.000Z' },
    ],
    createdAt: '2025-04-15T10:00:00.000Z',
    updatedAt: '2025-04-18T14:23:00.000Z',
  },
  {
    id: 'qt-2',
    quoteNumber: 'QT-0002',
    version: 1,
    title: 'South Yarra Apartment – Bedroom & Living',
    status: 'Accepted',
    customerId: 'cust-3',
    jobId: 'job-3',
    measureSheetId: 'ms-2',
    siteAddress: '3/42 Park Street, South Yarra VIC 3141',
    introMessage: 'Thank you for choosing Lusso Blinds & Curtains. Please see your personalised quote below.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due on completion. Lead time is approximately 4–6 weeks from order.',
    internalNotes: '',
    salesperson: 'Alex Chen',
    expiryDate: '2025-05-06',
    followUpDate: null,
    depositType: 'Percentage',
    depositValue: 50,
    includesGST: true,
    gstRate: 10,
    showSizesToClient: false,
    sentAt: '2025-04-25T10:00:00.000Z',
    viewedAt: '2025-04-25T18:00:00.000Z',
    acceptedAt: '2025-04-27T11:00:00.000Z',
    declinedAt: null,
    acceptedBy: { name: 'Priya Sharma', email: 'priya.sharma@hotmail.com', acceptedAt: '2025-04-27T11:00:00.000Z' },
    lineItems: [
      {
        id: 'qli-5', type: 'Required', choiceGroupId: null,
        location: 'Bedroom', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        description: 'Coastal White blockout roller blind, reveal fit',
        quantity: 2, widthMm: 1800, dropMm: 2100, fabricColour: 'Coastal White',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Reveal', heading: '',
        trackBaseBarColour: 'White', baseBarType: 'D30 Bump', chainColour: 'White',
        unitCostPrice: 220, labourCost: 100, marginPercent: 40, manualSellPrice: 620, supplier: 'Luxaflex', taxable: true,
        customerNotes: '', internalNotes: '', sortOrder: 0,
      },
      {
        id: 'qli-6', type: 'Required', choiceGroupId: null,
        location: 'Living Room', productTypeId: 'pt-1', productNameSnapshot: 'Curtain',
        description: 'Silver Sheer curtain with Wave Fold heading, motorised',
        quantity: 1, widthMm: 3600, dropMm: 2600, fabricColour: 'Silver Sheer',
        control: 'Left', returnSide: 'Left', motorSide: 'Left', fixing: 'Ceiling', heading: 'Wave Fold',
        trackBaseBarColour: 'Anodised', baseBarType: '', chainColour: '',
        unitCostPrice: 950, labourCost: 250, marginPercent: 40, manualSellPrice: 2450, supplier: 'Acmeda', taxable: true,
        customerNotes: 'Motorised operation.', internalNotes: 'Check wall bracket strength before install', sortOrder: 1,
      },
    ],
    activity: [
      { id: 'qa-4', type: 'created',  note: 'Quote created',                   user: 'Alex Chen',    createdAt: '2025-04-24T09:00:00.000Z' },
      { id: 'qa-5', type: 'sent',     note: 'Quote sent to customer via email', user: 'Alex Chen',    createdAt: '2025-04-25T10:00:00.000Z' },
      { id: 'qa-6', type: 'viewed',   note: 'Customer opened the quote',        user: 'Customer',     createdAt: '2025-04-25T18:00:00.000Z' },
      { id: 'qa-7', type: 'accepted', note: 'Customer accepted the quote',      user: 'Priya Sharma', createdAt: '2025-04-27T11:00:00.000Z' },
    ],
    comments: [],
    createdAt: '2025-04-24T09:00:00.000Z',
    updatedAt: '2025-04-27T11:00:00.000Z',
  },
  {
    id: 'qt-3',
    quoteNumber: 'QT-0003',
    version: 1,
    title: 'Mosman New Build – Roller Blinds',
    status: 'Draft',
    customerId: 'cust-2',
    jobId: 'job-2',
    measureSheetId: null,
    siteAddress: '7 Harbour View Crescent, Mosman NSW 2088',
    introMessage: 'Thank you for the opportunity to quote on your new build window furnishings. Please find our proposal below.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due on completion.',
    internalNotes: 'Builder wants all blinds installed before handover June 1. Confirm stock levels.',
    salesperson: 'Jordan Lee',
    expiryDate: '2025-05-22',
    followUpDate: null,
    depositType: 'Percentage',
    depositValue: 50,
    includesGST: true,
    gstRate: 10,
    showSizesToClient: false,
    sentAt: null,
    viewedAt: null,
    acceptedAt: null,
    declinedAt: null,
    acceptedBy: null,
    lineItems: [
      {
        id: 'qli-7', type: 'Required', choiceGroupId: null,
        location: 'Master Bedroom', productTypeId: 'pt-2', productNameSnapshot: 'Roller Blind',
        description: 'Charcoal blockout roller blind, ceiling fix',
        quantity: 2, widthMm: 2100, dropMm: 2400, fabricColour: 'Charcoal Blockout',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: '',
        trackBaseBarColour: 'White', baseBarType: 'D30 Bump', chainColour: 'White',
        unitCostPrice: 290, labourCost: 120, marginPercent: 40, manualSellPrice: 800, supplier: 'Luxaflex', taxable: true,
        customerNotes: '', internalNotes: '', sortOrder: 0,
      },
      {
        id: 'qli-8', type: 'Optional', choiceGroupId: null,
        location: 'Master Bedroom', productTypeId: 'pt-3', productNameSnapshot: 'Dual Roller Blind',
        description: 'Upgrade to dual roller blind (sheer + blockout) – Master Bedroom',
        quantity: 2, widthMm: 2100, dropMm: 2400, fabricColour: 'Charcoal / Natural Sheer',
        control: 'Right', returnSide: 'N/A', motorSide: 'N/A', fixing: 'Ceiling', heading: '',
        trackBaseBarColour: 'White', baseBarType: '', chainColour: 'White',
        unitCostPrice: 440, labourCost: 150, marginPercent: 40, manualSellPrice: 1130, supplier: 'Luxaflex', taxable: true,
        customerNotes: 'Optional upgrade – dual roller for day/night control.', internalNotes: '', sortOrder: 1,
      },
    ],
    activity: [
      { id: 'qa-8', type: 'created', note: 'Quote created', user: 'Jordan Lee', createdAt: '2025-05-01T09:00:00.000Z' },
    ],
    comments: [],
    createdAt: '2025-05-01T09:00:00.000Z',
    updatedAt: '2025-05-01T09:00:00.000Z',
  },
];

const SEED_SAVED_ITEMS = [
  { id: 'si-1', name: 'Roller Blind Supply & Install',   productTypeId: 'pt-2',  productNameSnapshot: 'Roller Blind', description: 'Custom roller blind, supply and install',             unitCostPrice: '',  labourCost: 120, marginPercent: 40, manualSellPrice: '', taxable: true, notes: '' },
  { id: 'si-2', name: 'Curtain Track Supply & Install',  productTypeId: 'pt-1',  productNameSnapshot: 'Curtain',      description: 'Custom curtain with track, supply and install',       unitCostPrice: '',  labourCost: 180, marginPercent: 40, manualSellPrice: '', taxable: true, notes: '' },
  { id: 'si-3', name: 'Motor Upgrade – Somfy',           productTypeId: null,    productNameSnapshot: '',             description: 'Somfy motor upgrade for automated operation',         unitCostPrice: 300, labourCost: 80,  marginPercent: 40, manualSellPrice: 530, taxable: true, notes: 'Includes remote control' },
  { id: 'si-4', name: 'Check Measure Fee',               productTypeId: null,    productNameSnapshot: '',             description: 'On-site check measure visit',                        unitCostPrice: 0,   labourCost: 0,   marginPercent: 40, manualSellPrice: 88,  taxable: true, notes: 'Credited towards order value' },
  { id: 'si-5', name: 'Installation Labour (per hour)',  productTypeId: null,    productNameSnapshot: '',             description: 'Installation labour charge',                          unitCostPrice: 0,   labourCost: 0,   marginPercent: 40, manualSellPrice: 110, taxable: true, notes: '' },
  { id: 'si-6', name: 'Pelmet Supply & Install',         productTypeId: 'pt-10', productNameSnapshot: 'Pelmet',       description: 'Fabric pelmet, custom made, supply and install',      unitCostPrice: 220, labourCost: 80,  marginPercent: 40, manualSellPrice: 460, taxable: true, notes: '' },
  { id: 'si-7', name: 'Removal & Disposal',              productTypeId: null,    productNameSnapshot: '',             description: 'Remove and dispose of existing window coverings',    unitCostPrice: 0,   labourCost: 0,   marginPercent: 40, manualSellPrice: 75,  taxable: true, notes: '' },
  { id: 'si-8', name: 'Somfy Situo 5 Remote',            productTypeId: null,    productNameSnapshot: '',             description: 'Somfy Situo 5-channel remote control',               unitCostPrice: 80,  labourCost: 0,   marginPercent: 40, manualSellPrice: 185, taxable: true, notes: '' },
];

const SEED_QUOTE_TEMPLATES = [
  {
    id: 'qtpl-1',
    name: 'Standard Roller Blind Quote',
    description: 'Default template for roller blind supply and install',
    introMessage: 'Thank you for requesting a quote. Please find our proposal for your roller blind installation below.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due on completion. Lead time approximately 3–5 weeks. All products are custom-made and non-refundable.',
    depositType: 'Percentage',
    depositValue: 50,
    expiryDays: 30,
    lineItems: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'qtpl-2',
    name: 'Premium Curtain Quote',
    description: 'Template for premium curtain and track installations',
    introMessage: 'Thank you for the opportunity to quote on your window furnishings. We specialise in premium curtains and tracks and look forward to transforming your space.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due on completion. Lead time approximately 4–6 weeks. All products are custom-made and non-refundable.',
    depositType: 'Percentage',
    depositValue: 50,
    expiryDays: 30,
    lineItems: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'qtpl-3',
    name: 'Builder / Developer Package',
    description: 'Multi-room quote for builders and developers',
    introMessage: 'Thank you for choosing Lusso Blinds & Curtains for your development. Please find our competitive pricing below for the complete window furnishing package.',
    termsAndConditions: 'A 50% deposit is required upon acceptance. Balance due 7 days prior to installation. Lead time approximately 4–8 weeks depending on volume. All products are custom-made.',
    depositType: 'Percentage',
    depositValue: 30,
    expiryDays: 14,
    lineItems: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

const DEFAULT_QUOTE_SETTINGS = {
  businessName: 'Lusso Blinds & Curtains',
  businessEmail: 'info@lusso.com.au',
  businessPhone: '03 9000 1234',
  defaultExpiryDays: 30,
  defaultDepositType: 'Percentage',
  defaultDepositValue: 50,
  defaultGSTRate: 10,
  includesGST: true,
  defaultTerms: 'A 50% deposit is required upon acceptance. Balance due on completion. Lead time is approximately 4–6 weeks from order. All products are custom-made and non-refundable.',
  defaultIntro: 'Thank you for the opportunity to quote on your window furnishings. Please find our detailed proposal below.',
  quoteNumberPrefix: 'QT-',
  currency: 'AUD',
  showSizesToClient: false,
};

export const getQuotes           = () => (get('lusso_quotes') || []).filter(q => !q.deletedAt);
export const getQuote            = (id) => (get('lusso_quotes') || []).find(q => q.id === id); // raw (includes deleted, for direct URL access)
export const getQuotesByJob      = (jobId) => getQuotes().filter(q => q.jobId === jobId);
export const getQuotesByCustomer = (customerId) => getQuotes().filter(q => q.customerId === customerId);

export const getNextQuoteNumber = () => {
  const n = (get('lusso_quote_counter') || 0) + 1;
  set('lusso_quote_counter', n);
  const settings = getQuoteSettings();
  return `${settings.quoteNumberPrefix}${String(n).padStart(4, '0')}`;
};

export const saveQuote = (quote) => {
  // Compute and persist totals so DB columns (grand_total, gst_amount, etc.) are always populated.
  const { subtotal, gst, total } = computeQuoteTotals(
    quote.lineItems || [], quote.depositType, quote.depositValue,
    quote.gstRate, quote.includesGST, quote.selectedLineItemIds || []
  );
  const costTotal = (quote.lineItems || []).reduce((s, li) => {
    if (li.unitCostPrice !== undefined) {
      const { totalCost } = calcItemPricing(li.unitCostPrice, li.labourCost, li.marginPercent, li.manualSellPrice, li.quantity);
      return s + totalCost * (Number(li.quantity) || 1);
    }
    // Legacy fallback
    return s + (Number(li.unitPrice) || 0) * (Number(li.quantity) || 1);
  }, 0);

  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quote.id);
  const now  = new Date().toISOString();
  const enriched = {
    ...quote,
    totalCost:  Math.round(costTotal * 100) / 100,
    totalSell:  Math.round(subtotal  * 100) / 100,
    gstAmount:  Math.round(gst       * 100) / 100,
    grandTotal: Math.round(total     * 100) / 100,
    createdAt:  quote.createdAt || now,
    updatedAt:  now,
  };
  if (idx >= 0) {
    list[idx] = enriched;
  } else {
    list.push(enriched);
  }
  set('lusso_quotes', list);
  db.saveQuote(list[list.findIndex(q => q.id === quote.id)]);
};

export const createQuote = (data) => {
  const id = uuidv4();
  const settings = getQuoteSettings();
  const now = new Date().toISOString();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + settings.defaultExpiryDays);
  const newNum = getNextQuoteNumber();
  const quote = {
    quoteNumber: newNum,
    version: 1,
    status: 'Draft',
    title: 'New Quote',
    customerId: null,
    jobId: null,
    measureSheetId: null,
    siteAddress: '',
    introMessage: settings.defaultIntro,
    termsAndConditions: settings.defaultTerms,
    internalNotes: '',
    salesperson: '',
    expiryDate: expiry.toISOString().split('T')[0],
    followUpDate: null,
    depositType: settings.defaultDepositType,
    depositValue: settings.defaultDepositValue,
    includesGST: settings.includesGST,
    gstRate: settings.defaultGSTRate,
    sentAt: null,
    viewedAt: null,
    acceptedAt: null,
    declinedAt: null,
    acceptedBy: null,
    lineItems: [],
    comments: [],
    ...data,
    id,
    activity: [{ id: uuidv4(), type: 'created', note: 'Quote created', user: data.salesperson || 'System', createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  saveQuote(quote);
  return quote;
};

export const addQuoteActivity = (quoteId, type, note, user = 'System') => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const entry = { id: uuidv4(), type, note, user, createdAt: new Date().toISOString() };
  list[idx].activity = [entry, ...(list[idx].activity || [])];
  list[idx].updatedAt = entry.createdAt;
  set('lusso_quotes', list);
  db.saveQuote(list[idx]); // activity is app-only but updatedAt changes — needed to bump updated_at in DB
};

export const sendQuote = (quoteId, user = 'System') => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  list[idx] = { ...list[idx], status: 'Sent', sentAt: now, updatedAt: now };
  const entry = { id: uuidv4(), type: 'sent', note: 'Quote sent to customer', user, createdAt: now };
  list[idx].activity = [entry, ...(list[idx].activity || [])];
  set('lusso_quotes', list);
  db.saveQuote(list[idx]);
  return list[idx];
};

export const markQuoteViewed = (quoteId) => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0 || list[idx].viewedAt) return list[idx];
  const now = new Date().toISOString();
  list[idx] = { ...list[idx], status: list[idx].status === 'Sent' ? 'Viewed' : list[idx].status, viewedAt: now, updatedAt: now };
  const entry = { id: uuidv4(), type: 'viewed', note: 'Customer opened the quote', user: 'Customer', createdAt: now };
  list[idx].activity = [entry, ...(list[idx].activity || [])];
  set('lusso_quotes', list);
  db.saveQuote(list[idx]);
  return list[idx];
};

export const acceptQuote = (quoteId, acceptanceInfo = {}) => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const info = { ...acceptanceInfo, acceptedAt: now };
  list[idx] = { ...list[idx], status: 'Accepted', acceptedAt: now, acceptedBy: info, updatedAt: now };
  const entry = { id: uuidv4(), type: 'accepted', note: `Quote accepted by ${info.name || 'customer'}`, user: info.name || 'Customer', createdAt: now };
  list[idx].activity = [entry, ...(list[idx].activity || [])];
  set('lusso_quotes', list);
  db.saveQuote(list[idx]);
  if (list[idx].jobId) updateJobStatus(list[idx].jobId, 'Awaiting Approval', info.name || 'Customer');
  return list[idx];
};

export const declineQuote = (quoteId, reason = '') => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  list[idx] = { ...list[idx], status: 'Declined', declinedAt: now, updatedAt: now };
  const entry = { id: uuidv4(), type: 'declined', note: reason ? `Quote declined: ${reason}` : 'Quote declined by customer', user: 'Customer', createdAt: now };
  list[idx].activity = [entry, ...(list[idx].activity || [])];
  set('lusso_quotes', list);
  db.saveQuote(list[idx]);
  return list[idx];
};

export const duplicateQuote = (quoteId, overrides = {}) => {
  const original = getQuote(quoteId);
  if (!original) return null;
  const now = new Date().toISOString();
  const settings = getQuoteSettings();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + settings.defaultExpiryDays);
  const dupe = {
    ...original,
    id: uuidv4(),
    quoteNumber: getNextQuoteNumber(),
    version: 1,
    status: 'Draft',
    sentAt: null, viewedAt: null, acceptedAt: null, declinedAt: null,
    acceptedBy: null,
    expiryDate: expiry.toISOString().split('T')[0],
    followUpDate: null,
    lineItems: original.lineItems.map(li => ({ ...li, id: uuidv4() })),
    activity: [{ id: uuidv4(), type: 'created', note: `Duplicated from ${original.quoteNumber}`, user: 'System', createdAt: now }],
    comments: [],
    createdAt: now,
    updatedAt: now,
    // Clear all Xero fields — the duplicate is a fresh quote, not linked to any invoice
    xeroInvoiceId: null,
    xeroInvoiceNumber: null,
    xeroInvoiceStatus: null,
    xeroInvoiceUrl: null,
    xeroInvoiceCreatedAt: null,
    xeroInvoiceCreatedBy: null,
    xeroLastSyncedAt: null,
    ...overrides,
  };
  saveQuote(dupe);
  return dupe;
};

export const addQuoteComment = (quoteId, type, author, message) => {
  const list = getQuotes();
  const idx  = list.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const comment = { id: uuidv4(), type, author, message, createdAt: new Date().toISOString() };
  list[idx].comments = [...(list[idx].comments || []), comment];
  list[idx].updatedAt = comment.createdAt;
  set('lusso_quotes', list);
  db.saveQuote(list[idx]); // comments is now a real DB column — must sync
  return comment;
};

export const deleteQuote = (quoteId, deletedBy = 'System') => {
  const all = get('lusso_quotes') || [];
  const idx = all.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], deletedAt: now, deletedBy, updatedAt: now };
  set('lusso_quotes', all);
  // Hard-delete from Supabase — fires Realtime DELETE event on all other devices instantly.
  db.deleteQuote(quoteId);
};

export const bulkDeleteQuotes = (ids, deletedBy = 'Admin') => {
  ids.forEach(id => deleteQuote(id, deletedBy));
};

// ─── Xero helpers ──────────────────────────────────────────────────────────────

/**
 * Update a quote in localStorage after a Xero invoice is created or synced.
 * Called from the UI after the Edge Function returns successfully.
 */
export const updateQuoteXeroInvoice = (quoteId, {
  xeroInvoiceId,
  xeroInvoiceNumber,
  xeroInvoiceStatus,
  xeroInvoiceUrl,
  xeroInvoiceCreatedAt,
  xeroInvoiceCreatedBy,
  xeroLastSyncedAt,
} = {}) => {
  const all = get('lusso_quotes') || [];
  const idx = all.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    ...(xeroInvoiceId        != null && { xeroInvoiceId }),
    ...(xeroInvoiceNumber    != null && { xeroInvoiceNumber }),
    ...(xeroInvoiceStatus    != null && { xeroInvoiceStatus }),
    ...(xeroInvoiceUrl       != null && { xeroInvoiceUrl }),
    ...(xeroInvoiceCreatedAt != null && { xeroInvoiceCreatedAt }),
    ...(xeroInvoiceCreatedBy != null && { xeroInvoiceCreatedBy }),
    xeroLastSyncedAt: xeroLastSyncedAt ?? now,
    updatedAt: now,
  };
  set('lusso_quotes', all);
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
};

/**
 * Update a customer record in localStorage after linking a Xero contact.
 */
export const updateCustomerXeroContact = (customerId, { xeroContactId, xeroContactName }) => {
  const all = get('lusso_customers') || [];
  const idx = all.findIndex(c => c.id === customerId);
  if (idx < 0) return;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], xeroContactId, xeroContactName, xeroLastSyncedAt: now, updatedAt: now };
  set('lusso_customers', all);
  db.saveCustomer(all[idx]);
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
};

// ─── Saved Items ──────────────────────────────────────────────────────────────

export const getSavedItems = () => get('lusso_saved_items') || [];
export const saveSavedItem = (item) => {
  const list = getSavedItems();
  const idx  = list.findIndex(i => i.id === item.id);
  if (idx >= 0) list[idx] = { ...item, updatedAt: new Date().toISOString() };
  else list.push({ ...item, id: item.id || uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  set('lusso_saved_items', list);
};
export const deleteSavedItem = (id) => set('lusso_saved_items', getSavedItems().filter(i => i.id !== id));

// ─── Quote Templates ──────────────────────────────────────────────────────────

export const getQuoteTemplates  = () => get('lusso_quote_templates') || [];
export const getQuoteTemplate   = (id) => getQuoteTemplates().find(t => t.id === id);
export const saveQuoteTemplate  = (tpl) => {
  const list = getQuoteTemplates();
  const idx  = list.findIndex(t => t.id === tpl.id);
  if (idx >= 0) list[idx] = { ...tpl, updatedAt: new Date().toISOString() };
  else list.push({ ...tpl, id: tpl.id || uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  set('lusso_quote_templates', list);
};
export const deleteQuoteTemplate = (id) => set('lusso_quote_templates', getQuoteTemplates().filter(t => t.id !== id));

// ─── Quote Settings ───────────────────────────────────────────────────────────

export const getQuoteSettings = () => get('lusso_quote_settings') || DEFAULT_QUOTE_SETTINGS;
export const saveQuoteSettings = (s) => set('lusso_quote_settings', { ...getQuoteSettings(), ...s });

// ─── Message Presets ──────────────────────────────────────────────────────────

export const DEFAULT_MESSAGE_PRESETS = {
  quoteEmailIntro: `Thank you for your enquiry. Please find your personalised quote from Lusso attached below.\n\nClick the button to view the full quote online, including pricing, product details and payment options. If you have any questions or would like to make any changes, please don't hesitate to get in touch — we're happy to help.\n\nWe look forward to working with you.`,
  quoteIntroMessage: `Thank you for choosing Lusso. Please find your quote below. All prices include GST. This quote is valid for 30 days from the date of issue.\n\nIf you have any questions, please contact us and we'll be happy to assist.`,
  quoteTerms: `• A 50% deposit is required to confirm your order.\n• Balance is due upon completion of installation.\n• Lead times are estimates only and subject to supplier availability.\n• All products remain the property of Lusso until paid in full.\n• Cancellations after order placement may incur a restocking fee.\n• Lusso is not liable for delays caused by third parties or circumstances beyond our control.`,
  smsFollowUp: `Hi {name}, just following up on the quote we sent you for your window treatments. Happy to answer any questions or make any changes. Give us a call or reply here 😊`,
  smsAppointmentReminder: `Hi {name}, this is a reminder of your appointment with Lusso tomorrow. Please let us know if you need to reschedule. See you then!`,
  smsQuoteReady: `Hi {name}, your quote from Lusso is ready to view. Click here to see the details: {link}`,
  smsOrderConfirmed: `Hi {name}, great news — your order has been confirmed! We'll be in touch soon with your installation date. Thanks for choosing Lusso 🎉`,
  smsInstallationBooked: `Hi {name}, your installation has been booked for {date}. Our team will arrive between {time}. Please ensure access to the property. See you then!`,
};

export const getMessagePresets = () => ({ ...DEFAULT_MESSAGE_PRESETS, ...(get('lusso_message_presets') || {}) });
export const saveMessagePresets = (s) => set('lusso_message_presets', { ...getMessagePresets(), ...s });

// ─── Priced Items Library ─────────────────────────────────────────────────────

export const getPricedItems      = () => get('lusso_priced_items') || [];
export const getPricedItem       = (id) => getPricedItems().find(p => p.id === id);
export const deletePricedItem    = (id) => {
  set('lusso_priced_items', getPricedItems().filter(p => p.id !== id));
  db.deletePricedItem(id);
};

export const savePricedItem = (item) => {
  const list = getPricedItems();
  const idx  = list.findIndex(p => p.id === item.id);
  const now  = new Date().toISOString();
  if (idx >= 0) list[idx] = { ...item, updatedAt: now };
  else list.push({ ...item, id: item.id || uuidv4(), createdAt: now, updatedAt: now });
  set('lusso_priced_items', list);
  db.savePricedItem(list[list.findIndex(p => p.id === item.id)]);
};

export const getPricedItemBatches = () => get('lusso_priced_item_batches') || [];
export const getPricedItemBatch   = (id) => getPricedItemBatches().find(b => b.id === id);

export const savePricedItemBatch = (batch) => {
  const batches = getPricedItemBatches();
  const idx = batches.findIndex(b => b.id === batch.id);
  if (idx >= 0) batches[idx] = batch; else batches.unshift(batch);
  set('lusso_priced_item_batches', batches);
  db.savePricedItemBatch(batch);
  return batch;
};

export const createPricedItemBatch = (fileName, totalRows) => {
  const batch = {
    id: uuidv4(),
    fileName,
    uploadedBy: 'Admin',
    source: 'Quotient Priced Items CSV Import',
    status: 'Previewed',
    totalRows,
    importedCount: 0,
    updatedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    skippedCount: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  return savePricedItemBatch(batch);
};

export const runPricedItemImport = async (batchId, rows) => {
  const batch = getPricedItemBatch(batchId);
  if (!batch) return null;

  const allItems = [...getPricedItems()];
  let imported = 0, updated = 0, dups = 0, errors = 0, skipped = 0;

  // Track which items need to be written to Supabase
  const toUpsert = [];

  for (const row of rows) {
    if (row.status === 'error' || row.status === 'empty') { errors++; continue; }
    const action = row.rowAction || 'skip';

    if (action === 'skip') {
      if (row.isDuplicate) dups++; else skipped++;
      continue;
    }

    const m = row.mapped;
    const isUpdate = action === 'update' && row.duplicate;
    const itemId = isUpdate ? row.duplicate.id : uuidv4();
    const now = new Date().toISOString();

    const item = {
      ...(isUpdate ? row.duplicate : {}),
      id: itemId,
      itemName:       m.itemName      || '',
      itemCode:       m.itemCode      || '',
      sku:            m.sku           || m.itemCode || '',
      description:    m.description   || '',
      category:       m.category      || '',
      supplier:       m.supplier      || '',
      unitType:       m.unitType      || '',
      costPrice:      m.costPrice     ?? null,
      sellPrice:      m.sellPrice     ?? null,
      labourCost:     m.labourCost    ?? null,
      marginPercent:  m.marginPercent ?? null,
      markupPercent:  m.markupPercent ?? null,
      gstApplicable:  m.gstApplicable !== false,
      taxRate:        m.taxRate       ?? 10,
      isActive:       true,
      notes:          m.notes         || '',
      tags:           m.tags          || '',
      source:         'Quotient Priced Items CSV Import',
      importBatchId:  batchId,
      createdAt:      isUpdate ? (row.duplicate.createdAt || now) : now,
      updatedAt:      now,
    };

    if (isUpdate) {
      const idx = allItems.findIndex(p => p.id === itemId);
      if (idx >= 0) allItems[idx] = item;
      updated++;
    } else {
      allItems.push(item);
      imported++;
    }

    toUpsert.push(item);
  }

  // 1. Save to localStorage immediately so UI updates right away
  set('lusso_priced_items', allItems);
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));

  // 2. Write directly to Supabase in batches — no manual Push needed
  let supabaseInserted = 0;
  let supabaseErrors   = [];
  if (supabase && toUpsert.length > 0) {
    const { inserted, errors: sbErrors } = await batchUpsertPricedItems(toUpsert);
    supabaseInserted = inserted;
    supabaseErrors   = sbErrors;
    if (sbErrors.length) {
      console.warn('[import] Priced items Supabase write errors:', sbErrors);
    } else {
      console.info(`[import] ✓ ${supabaseInserted} priced items saved to Supabase`);
    }
  }

  const updatedBatch = {
    ...batch,
    status: errors > 0 ? 'Completed with errors' : 'Completed',
    importedCount: imported,
    updatedCount: updated,
    duplicateCount: dups,
    errorCount: errors,
    skippedCount: skipped,
    supabaseInserted,
    supabaseErrors,
    completedAt: new Date().toISOString(),
  };
  savePricedItemBatch(updatedBatch);
  return updatedBatch;
};

// ─── Contact Import Batches ───────────────────────────────────────────────────

export const getImportBatches = () => get('lusso_import_batches') || [];
export const getImportBatch   = (id) => getImportBatches().find(b => b.id === id);

export const saveImportBatch = (batch) => {
  const batches = getImportBatches();
  const idx = batches.findIndex(b => b.id === batch.id);
  if (idx >= 0) batches[idx] = batch; else batches.unshift(batch);
  set('lusso_import_batches', batches);
  db.saveContactBatch(batch);
  return batch;
};

export const createImportBatch = (fileName, totalRows) => {
  const batch = {
    id: uuidv4(),
    fileName,
    uploadedBy: 'Admin',
    source: 'Quotient CSV Import',
    status: 'Previewed',
    totalRows,
    importedCount: 0,
    updatedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    skippedCount: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  return saveImportBatch(batch);
};

export const runContactImport = async (batchId, rows) => {
  const batch = getImportBatch(batchId);
  if (!batch) return null;

  const allCustomers = [...getCustomers()];
  let imported = 0, updated = 0, dups = 0, errors = 0, skipped = 0;

  // Track which customers need to be written to Supabase
  const toUpsert = [];

  for (const row of rows) {
    if (row.status === 'error' || row.status === 'empty') { errors++; continue; }
    const action = row.rowAction || 'skip';

    if (action === 'skip') {
      if (row.isDuplicate) dups++; else skipped++;
      continue;
    }

    const m = row.mapped;
    const isUpdate = action === 'update' && row.duplicate;
    const customerId = isUpdate ? row.duplicate.id : uuidv4();

    const addrLine = [m.address, [m.suburb, m.state, m.postcode].filter(Boolean).join(' '), m.country].filter(Boolean).join(', ');

    const customer = {
      ...(isUpdate ? row.duplicate : {}),
      id: customerId,
      name: m.name || '',
      businessName: m.businessName || '',
      firstName: m.firstName || '',
      lastName: m.lastName || '',
      email: m.email || '',
      phone: m.phone || '',
      mobile: m.mobile || '',
      address: addrLine,
      billingAddress: addrLine,
      suburb: m.suburb || '',
      state: m.state || '',
      postcode: m.postcode || '',
      country: m.country || '',
      notes: m.notes || '',
      source: 'Quotient CSV Import',
      tags: m.tags || '',
      importBatchId: batchId,
      preferredContact: m.email ? 'Email' : m.phone ? 'Phone' : 'Email',
      createdAt: isUpdate ? (row.duplicate.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isUpdate) {
      const idx = allCustomers.findIndex(c => c.id === customerId);
      if (idx >= 0) allCustomers[idx] = customer;
      updated++;
    } else {
      allCustomers.push(customer);
      imported++;
    }

    toUpsert.push(customer);
  }

  // 1. Save to localStorage immediately so UI updates right away
  set('lusso_customers', allCustomers);
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));

  // 2. Write directly to Supabase in batches — no manual Push needed
  let supabaseInserted = 0;
  let supabaseErrors   = [];
  if (supabase && toUpsert.length > 0) {
    const { inserted, errors: sbErrors } = await batchUpsertCustomers(toUpsert);
    supabaseInserted = inserted;
    supabaseErrors   = sbErrors;
    if (sbErrors.length) {
      console.warn('[import] Supabase write errors:', sbErrors);
    } else {
      console.info(`[import] ✓ ${supabaseInserted} customers saved to Supabase`);
    }
  }

  const updatedBatch = {
    ...batch,
    status: errors > 0 ? 'Completed with errors' : 'Completed',
    importedCount: imported,
    updatedCount: updated,
    duplicateCount: dups,
    errorCount: errors,
    skippedCount: skipped,
    supabaseInserted,
    supabaseErrors,
    completedAt: new Date().toISOString(),
  };
  saveImportBatch(updatedBatch);
  return updatedBatch;
};

// ─── Employees ────────────────────────────────────────────────────────────────

export const EMPLOYEE_ROLES        = ['Admin', 'Manager', 'Office Staff', 'Salesperson', 'Measurer', 'Installer'];
export const EMPLOYMENT_TYPES      = ['Full-time', 'Part-time', 'Casual', 'Contractor'];
export const EMPLOYEE_DEPARTMENTS  = ['Admin', 'Management', 'Sales', 'Office', 'Measuring', 'Installations'];

export const EMPLOYEE_ROLE_COLORS = {
  'Admin':        'bg-red-100 text-red-700',
  'Manager':      'bg-purple-100 text-purple-700',
  'Office Staff': 'bg-blue-100 text-blue-700',
  'Salesperson':  'bg-green-100 text-green-700',
  'Measurer':     'bg-amber-100 text-amber-700',
  'Installer':    'bg-teal-100 text-teal-700',
};

const SEED_EMPLOYEES = [
  {
    id: 'emp-1',
    firstName: 'Sarah', lastName: 'Mitchell', fullName: 'Sarah Mitchell',
    email: 'sarah@lusso.com.au', phone: '0412 345 678',
    jobTitle: 'Sales Manager', role: 'Manager', department: 'Sales',
    employmentType: 'Full-time', startDate: '2022-03-01', endDate: null,
    isActive: true,
    emergencyContactName: 'John Mitchell', emergencyContactPhone: '0413 111 222',
    notes: '',
    createdAt: '2022-03-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'emp-2',
    firstName: 'James', lastName: 'Chen', fullName: 'James Chen',
    email: 'james@lusso.com.au', phone: '0423 456 789',
    jobTitle: 'Senior Measurer', role: 'Measurer', department: 'Measuring',
    employmentType: 'Full-time', startDate: '2023-06-15', endDate: null,
    isActive: true,
    emergencyContactName: '', emergencyContactPhone: '',
    notes: '',
    createdAt: '2023-06-15T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'emp-3',
    firstName: 'Emma', lastName: 'Walsh', fullName: 'Emma Walsh',
    email: 'emma@lusso.com.au', phone: '0434 567 890',
    jobTitle: 'Office Coordinator', role: 'Office Staff', department: 'Office',
    employmentType: 'Part-time', startDate: '2024-01-10', endDate: null,
    isActive: true,
    emergencyContactName: '', emergencyContactPhone: '',
    notes: '',
    createdAt: '2024-01-10T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

export const getEmployees    = () => (get('lusso_employees') || []).filter(e => !e.deletedAt);
export const getEmployee     = (id) => (get('lusso_employees') || []).find(e => e.id === id);
export const getActiveEmployees = () => getEmployees().filter(e => e.isActive);

export const saveEmployee = (emp) => {
  const list = get('lusso_employees') || [];
  const now  = new Date().toISOString();
  const idx  = list.findIndex(e => e.id === emp.id);
  const record = { ...emp, updatedAt: now };
  if (idx >= 0) { list[idx] = record; } else { list.push({ ...record, createdAt: now }); }
  set('lusso_employees', list);
  db.saveEmployee(record);
  return record;
};

export const toggleEmployeeActive = (id) => {
  const list = get('lusso_employees') || [];
  const idx  = list.findIndex(e => e.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], isActive: !list[idx].isActive, updatedAt: new Date().toISOString() };
  set('lusso_employees', list);
  db.saveEmployee(list[idx]);
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const TASK_STATUSES   = ['To Do', 'In Progress', 'Waiting', 'Completed', 'Cancelled'];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

export const TASK_STATUS_COLORS = {
  'To Do':       'bg-slate-100 text-slate-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Waiting':     'bg-amber-100 text-amber-700',
  'Completed':   'bg-green-100 text-green-700',
  'Cancelled':   'bg-red-100 text-red-600',
};

export const TASK_PRIORITY_COLORS = {
  Low:    'bg-slate-100 text-slate-500',
  Medium: 'bg-blue-100 text-blue-600',
  High:   'bg-orange-100 text-orange-600',
  Urgent: 'bg-red-100 text-red-600',
};

const SEED_TASKS = [
  {
    id: 'task-1',
    title: 'Follow up on pending quote',
    description: 'Quote has been sitting for 2 weeks — check in with customer.',
    customerId: null, jobId: null,
    assignedEmployeeId: 'emp-1', createdByEmployeeId: null,
    dueDate: '2026-05-20', priority: 'High', status: 'To Do',
    notes: '', completedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'task-2',
    title: 'Book measure for new enquiry',
    description: 'Customer called requesting a site measure this week.',
    customerId: null, jobId: null,
    assignedEmployeeId: 'emp-2', createdByEmployeeId: null,
    dueDate: '2026-05-12', priority: 'Urgent', status: 'In Progress',
    notes: '', completedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

export const getTasks             = () => (get('lusso_tasks') || []).filter(t => !t.deletedAt);
export const getTask              = (id) => (get('lusso_tasks') || []).find(t => t.id === id);
export const getTasksByEmployee   = (empId) => getTasks().filter(t => t.assignedEmployeeId === empId);
export const getTasksByJob        = (jobId) => getTasks().filter(t => t.jobId === jobId);
export const getTasksByCustomer   = (cId) => getTasks().filter(t => t.customerId === cId);

export const saveTask = (task) => {
  const list = get('lusso_tasks') || [];
  const now  = new Date().toISOString();
  const idx  = list.findIndex(t => t.id === task.id);
  const record = { ...task, updatedAt: now };
  if (idx >= 0) { list[idx] = record; } else { list.push({ ...record, createdAt: now }); }
  set('lusso_tasks', list);
  db.saveTask(record);
  return record;
};

export const deleteTask = (id) => {
  const list = get('lusso_tasks') || [];
  const idx  = list.findIndex(t => t.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  list[idx] = { ...list[idx], deletedAt: now, updatedAt: now };
  set('lusso_tasks', list);
  db.saveTask(list[idx]);
};

export const completeTask = (id) => {
  const list = get('lusso_tasks') || [];
  const idx  = list.findIndex(t => t.id === id);
  if (idx < 0) return;
  const now  = new Date().toISOString();
  list[idx]  = { ...list[idx], status: 'Completed', completedAt: now, updatedAt: now };
  set('lusso_tasks', list);
  db.saveTask(list[idx]);
};

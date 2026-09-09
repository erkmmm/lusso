/**
 * A purchase order as it went out.
 *
 * This reads the stored snapshot and nothing else — not the measure sheet it
 * came from. That is the whole point: the sheet keeps changing, and the answer
 * to "what was on the PO we sent?" must not change with it.
 */
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  FileText, Printer, Download, Pencil, Trash2, History, Send, ArrowLeft, Mail, Loader,
} from 'lucide-react';
import { getPurchaseOrder, deletePurchaseOrder, getCustomer, getJob, getMeasureSheet } from '../store/data';
import { downloadPoPdf, exportPoXlsx, printPoNode } from '../lib/poDocument';
import { toast } from '../components/ToastContainer';
import Card from '../components/Card';
import PoPreview from '../components/PoPreview';

const STATUS_LABEL = {
  sent: 'Sent', printed: 'Printed', downloaded: 'Downloaded', exported: 'Exported',
};

const when = (iso) => {
  if (!iso) return '';
  try { return format(parseISO(iso), 'd MMM yyyy, h:mma'); } catch { return ''; }
};

export default function PurchaseOrderView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const po = getPurchaseOrder(id);
  if (!po) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="mt-6 text-slate-500">Purchase order not found.</p>
        <Link to="/measure-sheets" className="text-sm font-medium text-amber-600 hover:underline">Back to measure sheets</Link>
      </div>
    );
  }

  const snap = po.snapshot || {};
  const job = po.jobId ? getJob(po.jobId) : null;
  const customer = po.customerId ? getCustomer(po.customerId) : null;
  // The sheet can be gone (deleted, or never synced to this device) — the PO
  // still reads fine, it just can't be re-opened for editing.
  const sheet = po.measureSheetId ? getMeasureSheet(po.measureSheetId) : null;

  const handleDownload = async () => {
    setBusy(true);
    try { await downloadPoPdf(snap); }
    catch (e) { console.error('[PO] PDF download failed', e); toast('Could not generate the PDF.', 'error'); }
    finally { setBusy(false); }
  };

  const handleDelete = () => {
    deletePurchaseOrder(po.id);
    toast(`${po.poNumber || 'Purchase order'} removed from the history.`, 'info');
    navigate(sheet ? `/measure-sheets/${po.measureSheetId}` : '/measure-sheets');
  };

  const btn = 'flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50';

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 mb-2">
              <ArrowLeft size={13} /> Back
            </button>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText size={18} /> {po.poNumber || 'Purchase order'}
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {STATUS_LABEL[po.status] || 'Issued'}
              </span>
              {(po.revision || 1) > 1 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">rev {po.revision}</span>
              )}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {[snap.customerName || po.customerName, po.jobNumber, `${po.itemCount ?? snap.rows?.length ?? 0} curtain${(po.itemCount ?? 0) === 1 ? '' : 's'}`]
                .filter(Boolean).join(' · ')}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
              {po.recipient && <span className="flex items-center gap-1.5"><Mail size={12} />{po.recipient}</span>}
              {po.sentAt && <span className="flex items-center gap-1.5"><Send size={12} />Sent {when(po.sentAt)}</span>}
              <span className="flex items-center gap-1.5"><History size={12} />Created {when(po.createdAt)}{po.createdBy ? ` by ${po.createdBy}` : ''}</span>
              {po.updatedAt && po.updatedAt !== po.createdAt && <span>· Last issued {when(po.updatedAt)}</span>}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap flex-shrink-0 no-print">
            {sheet && (
              <button onClick={() => navigate(`/measure-sheets/${po.measureSheetId}/purchase-order?po=${po.id}`)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white">
                <Pencil size={13} /> Edit &amp; re-issue
              </button>
            )}
            <button onClick={handleDownload} disabled={busy} className={btn}>
              {busy ? <Loader size={13} className="animate-spin" /> : <FileText size={13} />} Download PDF
            </button>
            <button onClick={() => printPoNode('po-history-print')} className={btn}>
              <Printer size={13} /> Print
            </button>
            <button onClick={() => exportPoXlsx(snap)} className={btn}>
              <Download size={13} /> Export XLSX
            </button>
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-100 text-xs no-print">
          {job && <Link to={`/jobs/${job.id}`} className="font-medium text-amber-600 hover:underline">View job</Link>}
          {sheet && <Link to={`/measure-sheets/${po.measureSheetId}`} className="font-medium text-amber-600 hover:underline">View measure sheet</Link>}
          {customer && <Link to={`/customers/${customer.id}`} className="font-medium text-amber-600 hover:underline">View customer</Link>}
        </div>
      </Card>

      <p className="text-xs text-slate-400 px-1">
        This is the order exactly as it was issued. Later edits to the measure sheet don&rsquo;t change it —
        to correct the order, edit and re-issue it.
      </p>

      {/* The document that went out */}
      <Card>
        <PoPreview snapshot={snap} id="po-history-print" />
      </Card>

      {/* The covering email, as sent */}
      {(po.message || po.subject) && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Message sent with it</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {[po.recipient && `To ${po.recipient}`, po.subject].filter(Boolean).join(' · ')}
            </p>
          </div>
          <p className="p-5 text-sm text-slate-600 whitespace-pre-wrap">{po.message}</p>
        </Card>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDelete(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <h3 className="font-semibold text-slate-800">Remove {po.poNumber || 'this order'} from the history?</h3>
              <p className="text-sm text-slate-600 mt-2">
                The supplier still has whatever was sent — this only removes our record of it.
              </p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={handleDelete}
                className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 text-white">Remove</button>
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

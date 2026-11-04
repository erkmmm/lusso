import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {getMeasureSheet,getTakeoffByJob} from '../store/data';
import {useDataRefresh} from '../hooks/useDataRefresh';
import {downloadTakeoffPlan} from '../lib/takeoffStorage';
import {loadPdf} from '../lib/pdfRender';
import OpeningWorkspace from '../components/takeoff/OpeningWorkspace';
export default function OpeningReview() {
  const {id}=useParams(),navigate=useNavigate();
  useDataRefresh();
  const sheet=getMeasureSheet(id),takeoff=sheet?getTakeoffByJob(sheet.jobId):null;
  const [pdf,setPdf]=useState(null),[planError,setPlanError]=useState('');
  useEffect(()=>{
    let active=true,doc;
    if(takeoff?.filePath) downloadTakeoffPlan(takeoff.filePath).then(bytes=>{if(!bytes)throw new Error('The project plan is unavailable.');return loadPdf(bytes);}).then(value=>{doc=value;if(active)setPdf(value);else value.destroy();}).catch(error=>{if(active)setPlanError(error.message);});
    return ()=>{active=false;doc?.destroy();};
  },[takeoff?.filePath]);
  if(!sheet) return <p className="p-6">Measure sheet not found.</p>;
  return <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4"><Link className="text-sm text-slate-500" to={`/measure-sheets/${id}`}>← Back to measure sheet</Link>{planError && <p className="text-sm text-amber-700">{planError} You can still edit specifications.</p>}<OpeningWorkspace jobId={sheet.jobId} sheetId={sheet.id} pdf={pdf} takeoff={takeoff} onJump={(page,itemId)=>navigate(`/jobs/${sheet.jobId}/takeoff?page=${page}&opening=${itemId || ''}`)} onPlace={lineId=>navigate(`/jobs/${sheet.jobId}/takeoff?place=${lineId}`)}/></div>;
}

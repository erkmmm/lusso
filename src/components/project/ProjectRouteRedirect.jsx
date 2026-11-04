import {Navigate,useLocation,useParams} from 'react-router-dom';
import {getQuote,getMeasureSheet,getPurchaseOrder,getJob} from '../../store/data';
import {useDataRefresh} from '../../hooks/useDataRefresh';
import {mapProjectDestination} from '../../lib/projectWorkspace';
export default function ProjectRouteRedirect({kind,children}){useDataRefresh();const params=useParams(),location=useLocation();const record=kind==='quote'?getQuote(params.id):kind==='sheet'?getMeasureSheet(params.id):kind==='order'?getPurchaseOrder(params.id):null;const queryJob=new URLSearchParams(location.search).get('jobId');const jobId=record?.jobId || (kind==='job'?params.id:kind==='newQuote'?params.jobId:null) || (queryJob && getJob(queryJob)?queryJob:null);const to=jobId?mapProjectDestination(jobId,location.pathname+location.search):null;return to && to!==location.pathname+location.search?<Navigate to={to} replace/>:children;}

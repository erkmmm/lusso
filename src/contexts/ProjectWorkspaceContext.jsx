import {createContext,useContext,useCallback} from 'react';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {mapProjectDestination} from '../lib/projectWorkspace';
export const ProjectWorkspaceContext=createContext(null);
export const useProjectWorkspace=()=>useContext(ProjectWorkspaceContext);
export function useProjectParams(){const params=useParams(),workspace=useProjectWorkspace();return workspace?{...params,...workspace.params}:params;}
export function useProjectSearchParams(){const existing=useSearchParams(),workspace=useProjectWorkspace();return workspace?.search!==undefined?[new URLSearchParams(workspace.search),existing[1]]:existing;}
export function useProjectNavigate(){const navigate=useNavigate(),workspace=useProjectWorkspace();const jobId=workspace?.jobId,customerId=workspace?.customerId,openPanel=workspace?.openPanel,state=workspace?.state;return useCallback((to,options)=>{
 if(jobId && typeof to==='string' && to.split('?')[0]===`/customers/${customerId}`){openPanel?.('customer');return;}
 const mapped=jobId?mapProjectDestination(jobId,to):to;
 if(jobId && typeof mapped==='string' && mapped.startsWith(`/jobs/${jobId}?`)){
  const query=new URL(mapped,'https://app.lusso.com.au').searchParams;
  const combined=new URLSearchParams({...state,...Object.fromEntries(query)});navigate(`/jobs/${jobId}?${combined}`,options);
 }else navigate(mapped,options);
},[jobId,customerId,openPanel,state,navigate]);}

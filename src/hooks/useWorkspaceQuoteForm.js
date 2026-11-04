import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {useProjectWorkspace} from '../contexts/ProjectWorkspaceContext';
function read(key){try{return key?JSON.parse(localStorage.getItem(key)):null;}catch{return null;}}
export default function useWorkspaceQuoteForm(initialise,source){
 const workspace=useProjectWorkspace(),{user}=useAuth();
 const key=workspace && user?`ui.project-quote-edit.v1:${user.id}:${workspace.jobId}:${source?.id || 'new'}`:null;
 const [cached]=useState(()=>read(key));
 const valid=Boolean(cached?.form && workspace && cached.form.jobId===workspace.jobId);
 const [conflict,setConflict]=useState(Boolean(valid && cached.sourceVersion!==(source?.updatedAt || null)));
 const baseline=useRef(source?.updatedAt || null);
 const [form,setForm]=useState(()=>valid && cached.sourceVersion===(source?.updatedAt || null)?cached.form:initialise());
 useEffect(()=>{if(!key || !form || conflict)return;try{localStorage.setItem(key,JSON.stringify({sourceVersion:baseline.current,form}));}catch{/* browser storage unavailable */}},[key,form,conflict]);
 const markSaved=useCallback(quote=>{baseline.current=quote?.updatedAt || null;try{if(key)localStorage.removeItem(key);}catch{/* private mode */}},[key]);
 const checkFresh=current=>{if(key && baseline.current && current?.updatedAt!==baseline.current)throw new Error('This draft changed elsewhere. Reload it before replacing newer changes. Your typed copy is kept in this browser.');};
 const discard=()=>{try{if(key)localStorage.removeItem(key);}catch{/* private mode */}setConflict(false);};
 const download=()=>{if(!cached?.form)return;const url=URL.createObjectURL(new Blob([JSON.stringify(cached.form,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`unsaved-${cached.form.quoteNumber || 'quote'}.json`;link.click();URL.revokeObjectURL(url);};
 return [form,setForm,{conflict,discard,download,markSaved,checkFresh}];
}

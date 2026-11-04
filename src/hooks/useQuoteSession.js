import {useCallback,useRef,useState} from 'react';
import {readQuoteSession,writeQuoteSession} from '../lib/quoteSession';
const storage=()=>{try{return window.localStorage;}catch{return null;}};
export default function useQuoteSession(userId,jobId){
  const [session,setSession]=useState(()=>readQuoteSession(storage(),userId,jobId));
  const latest=useRef(session);
  const [saveFailed,setSaveFailed]=useState(false);
  const update=useCallback(patch=>{
    const next={...latest.current,...patch};latest.current=next;setSession(next);
    setSaveFailed(!writeQuoteSession(storage(),userId,jobId,next));
  },[userId,jobId]);
  return {session,update,saveFailed};
}

import {useEffect,useRef,useState} from 'react';
import {Application,Page,recruitmentRequest} from '../lib/recruitmentApi';
import {assessmentNeedsRefresh} from '../lib/assessmentProgress';

const snapshot=(rows:Application[])=>JSON.stringify(rows.map(row=>[row.applicationId,row.currentStage,row.assessment?.status,row.assessment?.score,!!row.assessment?.link]));

/** Refresh saved progress only while visible; unchanged responses back off to two minutes. */
export function useAssessmentRefresh(items:Application[],path:string,revision:number,paused:boolean,onRows:(value:Page<Application>)=>void,onError:(message:string)=>void){
  const [visible,setVisible]=useState(()=>document.visibilityState!=='hidden');
  const callbacks=useRef({onRows,onError});callbacks.current={onRows,onError};
  const progress=useRef({path:'',revision:-1,snapshot:'',unchanged:0});
  useEffect(()=>{const update=()=>setVisible(document.visibilityState!=='hidden');document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  useEffect(()=>{
    const before=snapshot(items);
    if(progress.current.path!==path||progress.current.revision!==revision||progress.current.snapshot!==before){
      progress.current={path,revision,snapshot:before,unchanged:0};
    }
    if(paused||!visible||!items.some(assessmentNeedsRefresh))return;
    let active=true;const controller=new AbortController();
    const delay=Math.min(120_000,30_000*2**Math.min(progress.current.unchanged,2));
    const timer=setTimeout(()=>{
      void recruitmentRequest<Page<Application>>(path,undefined,'GET',controller.signal).then(value=>{
        if(!active)return;
        const next=snapshot(value.items);
        progress.current={path,revision,snapshot:next,unchanged:next===before?progress.current.unchanged+1:0};
        callbacks.current.onRows(value);
      }).catch(()=>{if(active)callbacks.current.onError('Could not refresh assessment results. Use Refresh results to try again.');});
    },delay);
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[items,path,revision,paused,visible]);
}

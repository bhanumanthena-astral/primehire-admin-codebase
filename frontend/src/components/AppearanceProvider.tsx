import React, {useEffect} from 'react';
import {applyAppearance, appearancePreference} from '../lib/appearance';

/** Follow system appearance unless the person has made an explicit choice. */
export function AppearanceProvider({children}:{children:React.ReactNode}) {
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    const systemChanged=()=>{if(appearancePreference()==='system')applyAppearance();};
    const storageChanged=(event:StorageEvent)=>{if(event.key==='placement-theme'||event.key===null)applyAppearance();};
    applyAppearance();
    media?.addEventListener('change',systemChanged);
    window.addEventListener('storage',storageChanged);
    return()=>{media?.removeEventListener('change',systemChanged);window.removeEventListener('storage',storageChanged);};
  },[]);
  return <>{children}</>;
}

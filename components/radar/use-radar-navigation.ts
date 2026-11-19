"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultRadarLocation, parseRadarLocation, radarLocationSearch } from '@/lib/radar-navigation';
import type { RadarLocation } from '@/lib/radar-navigation';

type Entry = { scroll: number; detailFrom?: string };
export function useRadarNavigation() {
  const [location,setLocation] = useState<RadarLocation>(defaultRadarLocation);
  const [ready,setReady] = useState(false);
  const current = useRef(location);
  const restore = useRef<number|null>(null);
  const navigate = useCallback((patch:Partial<RadarLocation>, options:{replace?:boolean; scroll?:number; detail?:boolean}={}) => {
    const previous=current.current;
    const next=parseRadarLocation(radarLocationSearch({...previous,...patch}));
    const before=radarLocationSearch(previous), after=radarLocationSearch(next);
    if(before===after) return;
    const entry = (window.history.state?.radar || {}) as Entry;
    window.history.replaceState({...window.history.state,radar:{...entry,scroll:window.scrollY}},'',window.location.href);
    const scroll=options.scroll ?? (next.item ? window.scrollY : 0);
    const state={...window.history.state,radar:{scroll,...(options.detail ? {detailFrom:before} : {})}};
    window.history[options.replace ? 'replaceState' : 'pushState'](state,'',`${window.location.pathname}${after}${window.location.hash}`);
    current.current=next; restore.current=scroll; setLocation(next);
  },[]);
  const closeDetail=useCallback((expectedItemId?: string)=>{
    if(!current.current.item || expectedItemId && current.current.item!==expectedItemId) return;
    if(typeof window.history.state?.radar?.detailFrom === 'string') window.history.back();
    else navigate({item:'',annotation:''},{replace:true,scroll:window.history.state?.radar?.scroll ?? 0});
  },[navigate]);
  useEffect(()=>{
    const update=()=>{const value=parseRadarLocation(window.location.search); current.current=value; restore.current=Number(window.history.state?.radar?.scroll)||0; setLocation(value); setReady(true);};
    const previous=window.history.scrollRestoration; window.history.scrollRestoration='manual';
    update(); window.addEventListener('popstate',update);
    const preserve=()=>window.history.replaceState({...window.history.state,radar:{...window.history.state?.radar,scroll:window.scrollY}},'',window.location.href);
    let scrollFrame=0;
    const rememberScroll=()=>{
      if(scrollFrame || restore.current!==null) return;
      const href=window.location.href;
      scrollFrame=requestAnimationFrame(()=>{
        scrollFrame=0;
        if(window.location.href===href && restore.current===null) preserve();
      });
    };
    window.addEventListener('scroll',rememberScroll,{passive:true});
    window.addEventListener('pagehide',preserve);
    return()=>{window.removeEventListener('popstate',update);window.removeEventListener('pagehide',preserve);window.removeEventListener('scroll',rememberScroll);cancelAnimationFrame(scrollFrame);window.history.scrollRestoration=previous;};
  },[]);
  const restoreScroll=useCallback(()=>{
    if(restore.current===null) return;
    const top=restore.current; restore.current=null;
    requestAnimationFrame(()=>window.scrollTo({top,behavior:'instant'}));
  },[]);
  return {location,ready,navigate,closeDetail,restoreScroll};
}

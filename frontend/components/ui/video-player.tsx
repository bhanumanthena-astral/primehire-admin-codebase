import {useEffect,useRef,useState} from 'react';
import {Play,Pause,Volume2,VolumeX,Maximize,Loader2,RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';

// Shared shadcn-style player: themed controls around the native media element.
// Follows https://www.shadcn.io/ui/video-player without adding another UI runtime.
export function VideoPlayer({src,label='Candidate video',loading=false,error='',onRequest,onError,autoPlay=false}:{
 src?:string;label?:string;loading?:boolean;error?:string;onRequest?:()=>void;onError?:()=>void;autoPlay?:boolean;
}){
 const root=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
 const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0),[muted,setMuted]=useState(false),[volume,setVolume]=useState(1),[failed,setFailed]=useState(false);
 useEffect(()=>{setPlaying(false);setTime(0);setDuration(0);setFailed(false);},[src]);
 function play(){
  if(loading)return;
  if(!src||error){onRequest?.();return;}
  const element=video.current;if(!element)return;
  if(failed){setFailed(false);element.load();}
  if(element.paused)void element.play()?.catch(()=>setPlaying(false));else element.pause();
 }
 function seek(value:number){if(video.current&&duration>0)video.current.currentTime=Math.max(0,Math.min(duration,value));}
 const clock=(value:number)=>Number.isFinite(value)?`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`:'0:00';
 return <div ref={root} data-slot="video-player" className="w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground" onKeyDown={event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||(event.target as HTMLElement).tagName==='INPUT')return;
  if(event.key.toLowerCase()==='k'){event.preventDefault();play();}
 }}>
  <div className="relative flex aspect-video max-h-[75dvh] items-center justify-center bg-black">
   {src&&<video key={src} ref={video} src={src} aria-label={label} playsInline preload="none" autoPlay={autoPlay} className="h-full w-full object-contain" onClick={play}
    onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
    onTimeUpdate={event=>setTime(event.currentTarget.currentTime)} onDurationChange={event=>setDuration(Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:0)}
    onVolumeChange={event=>{setMuted(event.currentTarget.muted);setVolume(event.currentTarget.volume);}}
    onError={()=>{setFailed(true);onError?.();}}/>}
   {(!playing||loading||error||failed)&&<Button size="icon" variant="secondary" className="absolute size-16 rounded-full shadow-lg" aria-label={loading?'Loading video':error||failed?'Retry video':'Play video'} disabled={loading} onClick={play}>
    {loading?<Loader2 className="size-7 animate-spin"/>:error||failed?<RotateCcw className="size-7"/>:<Play className="size-7"/>}
   </Button>}
  </div>
  <div role="group" aria-label="Video controls" dir="ltr" className="flex flex-wrap items-center gap-2 border-t border-border bg-card p-2">
   <Button size="icon" variant="ghost" aria-label={playing?'Pause':'Play'} disabled={loading} onClick={play}>{playing?<Pause/>:<Play/>}</Button>
   <input type="range" aria-label="Seek video" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min={0} max={duration||1} step={0.1} value={time} disabled={!duration} onChange={event=>seek(Number(event.target.value))} className="min-w-16 flex-1 accent-primary"/>
   <span className="text-xs tabular-nums">{clock(time)} / {duration?clock(duration):'--:--'}</span>
   <Button size="icon" variant="ghost" aria-label={muted?'Unmute':'Mute'} disabled={!src} onClick={()=>{if(video.current)video.current.muted=!video.current.muted;}}>{muted?<VolumeX/>:<Volume2/>}</Button>
   <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted?0:volume} disabled={!src} className="hidden w-20 accent-primary sm:block" onChange={event=>{if(video.current){video.current.volume=Number(event.target.value);video.current.muted=false;}}}/>
   <Button size="icon" variant="ghost" aria-label="Fullscreen video" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen?.();else void root.current?.requestFullscreen?.().catch(()=>{});}}><Maximize/></Button>
  </div>
  {(error||failed)&&<p role="alert" className="p-3 text-sm text-destructive">{error||'Video playback is unavailable. Retry or review the transcript.'}</p>}
 </div>;
}

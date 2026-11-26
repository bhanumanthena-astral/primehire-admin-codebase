import {useRef} from 'react';
import {motion, useReducedMotion, useSpring} from 'motion/react';
import {Slider} from '@/components/ui/slider';

// Two-handle adaptation of React Bits Elastic Slider's rubber-band interaction.
// https://reactbits.dev/c/components/elastic-slider — see react-bits.LICENSE.txt.
export function ElasticRangeSlider({value, onChange, disabled, label}: {
  value:number[]; onChange:(value:number[])=>void; disabled?:boolean; label:string;
}) {
  const bounds=useRef<HTMLDivElement>(null);
  const dragging=useRef(false);
  const reduced=useReducedMotion();
  const stretch=useSpring(0,{stiffness:300,damping:20});
  function release(){dragging.current=false;stretch.set(0);}
  return <div ref={bounds} className="px-3 py-2"
    onPointerDownCapture={()=>{if(!disabled)dragging.current=true;}}
    onPointerMove={event=>{
      if(!dragging.current||reduced||disabled||!bounds.current)return;
      const rect=bounds.current.getBoundingClientRect();
      const distance=event.clientX<rect.left?event.clientX-rect.left:event.clientX>rect.right?event.clientX-rect.right:0;
      stretch.set(2*(1/(1+Math.exp(-distance/24))-0.5)*24);
    }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <motion.div style={{x:reduced?0:stretch}} className="group">
      <Slider value={value} onValueChange={onChange} min={0} max={100} step={1} minStepsBetweenValues={0} disabled={disabled}
        getAriaLabel={index=>`${index===0?'Minimum':'Maximum'} ${label}`} getAriaValueText={(_,score)=>`${score}%`}
        className="[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:transition-[height] [&_[data-slot=slider-track]]:duration-200 hover:[&_[data-slot=slider-track]]:h-3 focus-within:[&_[data-slot=slider-track]]:h-3 motion-reduce:[&_[data-slot=slider-track]]:transition-none"/>
    </motion.div>
    <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
  </div>;
}

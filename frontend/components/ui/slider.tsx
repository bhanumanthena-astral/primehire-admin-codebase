import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@/lib/utils';

type SliderProps = SliderPrimitive.Root.Props<number[]> & Pick<SliderPrimitive.Thumb.Props, 'getAriaLabel' | 'getAriaValueText'>;

export function Slider({className, value, defaultValue = [0], getAriaLabel, getAriaValueText, ...props}: SliderProps) {
  const values = value ?? defaultValue;
  return <SliderPrimitive.Root data-slot="slider" value={value} defaultValue={defaultValue}
    className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50', className)} {...props}>
    <SliderPrimitive.Control className="relative flex w-full items-center py-3">
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Indicator data-slot="slider-range" className="absolute h-full rounded-full bg-primary"/>
      </SliderPrimitive.Track>
      {values.map((_, index) => <SliderPrimitive.Thumb key={index} index={index} getAriaLabel={getAriaLabel} getAriaValueText={getAriaValueText} data-slot="slider-thumb"
        className="block size-5 shrink-0 rounded-full border-2 border-primary bg-card shadow-sm outline-none transition-shadow hover:ring-4 hover:ring-primary/15 focus-visible:ring-4 focus-visible:ring-ring/40"/>)}
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>;
}

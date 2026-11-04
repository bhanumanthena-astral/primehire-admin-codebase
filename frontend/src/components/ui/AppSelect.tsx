import React from 'react';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {cn} from '@/lib/utils';

type Option = {value: string; label: React.ReactNode; disabled?: boolean};
function optionsFrom(children: React.ReactNode, disabled = false): Option[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{value?: string | number; children?: React.ReactNode; disabled?: boolean}>(child)) return [];
    if (child.type === 'option') return [{value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: disabled || child.props.disabled}];
    return optionsFrom(child.props.children, disabled || child.props.disabled);
  });
}

/** Shadcn Select with option children, keeping existing form values intact. */
export function AppSelect({children, value, defaultValue, onValueChange, className, name, required, disabled, ...props}:
  Omit<React.ComponentProps<typeof SelectTrigger>, 'onChange' | 'value' | 'defaultValue' | 'size'> & {
    value?: string | number; defaultValue?: string | number; onValueChange?: (value: string) => void;
    name?: string; required?: boolean;
  }) {
  const options = optionsFrom(children);
  const [open, setOpen] = React.useState(false);
  return <Select open={open} onOpenChange={setOpen} items={options} value={value === undefined ? undefined : String(value)}
    defaultValue={defaultValue === undefined ? (value === undefined ? options[0]?.value : undefined) : String(defaultValue)}
    onValueChange={next => {setOpen(false); onValueChange?.(next ?? '');}} name={name} required={required} disabled={disabled}>
    <SelectTrigger {...props} value={value === undefined ? undefined : String(value)} className={cn('min-h-9 w-full rounded-lg bg-card', className)}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false}>
      {options.map((option, index) => <SelectItem key={`${option.value}-${index}`} value={option.value} data-value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

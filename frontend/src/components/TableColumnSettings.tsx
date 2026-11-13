import {Popover} from '@base-ui/react/popover';
import {ArrowLeft,ArrowRight,Settings2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import type {useTableColumnSettings} from '../lib/useTableColumnSettings';

export function TableColumnSettings({settings}:{settings:ReturnType<typeof useTableColumnSettings>}){
  return <Popover.Root><Popover.Trigger render={<Button variant="outline" size="sm"/>}><Settings2 size={15}/>Columns</Popover.Trigger>
    <Popover.Portal><Popover.Positioner align="end" sideOffset={8} className="z-[80] outline-none"><Popover.Popup className="flex flex-col w-[min(340px,calc(100vw-24px))] max-h-[min(540px,calc(100dvh-48px))] overflow-hidden rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none">
      <div className="flex shrink-0 items-center justify-between gap-3"><Popover.Title className="text-sm font-bold">Table columns</Popover.Title><Popover.Close render={<Button variant="ghost" size="icon-xs"/>} aria-label="Close column settings"><X size={15}/></Popover.Close></div>
      <Popover.Description className="mb-3 mt-1 shrink-0 text-xs text-muted-foreground">Choose columns and move them left or right. Your layout is saved in this browser.</Popover.Description>
      <ol className="min-h-0 space-y-1 overflow-y-auto overscroll-contain" aria-label="Column order">{settings.ordered.map((column,index)=><li key={column.key} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-muted/50"><Checkbox aria-label={`Show ${column.label}`} checked={!settings.hidden.includes(column.key)} disabled={column.required} onCheckedChange={()=>settings.toggle(column.key)}/><span className="min-w-0 flex-1 text-xs">{column.label}{column.required&&<small className="ml-1 text-muted-foreground">Required</small>}</span><Button variant="ghost" size="icon-xs" aria-label={`Move ${column.label} left`} disabled={index===0} onClick={()=>settings.move(column.key,-1)}><ArrowLeft size={14}/></Button><Button variant="ghost" size="icon-xs" aria-label={`Move ${column.label} right`} disabled={index===settings.ordered.length-1} onClick={()=>settings.move(column.key,1)}><ArrowRight size={14}/></Button></li>)}</ol>
      <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-border pt-3"><span className="text-xs text-muted-foreground">{settings.visible.length} of {settings.ordered.length} shown</span><Button variant="outline" size="sm" onClick={settings.reset}>Reset to default</Button></div>
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}



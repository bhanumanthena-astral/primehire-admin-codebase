import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {AppearanceProvider} from '../components/AppearanceProvider';
import {ModeToggle} from '../components/ui/primitives';
import {setAppearance} from './appearance';
import {readFileSync,existsSync} from 'node:fs';
const css=readFileSync(existsSync('src/index.css')?'src/index.css':'frontend/src/index.css','utf8');

let systemDark=false;
let listener:()=>void;
beforeEach(()=>{
  localStorage.clear();document.documentElement.classList.remove('dark');systemDark=false;
  vi.stubGlobal('matchMedia',vi.fn(()=>({get matches(){return systemDark;},addEventListener:(_name:string,fn:()=>void)=>{listener=fn;},removeEventListener:vi.fn()})));
});
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='';});

it('follows system appearance and respects a deliberate override',()=>{
  render(<AppearanceProvider><ModeToggle/></AppearanceProvider>);
  expect(screen.getByRole('button',{name:'Switch to dark mode'})).toBeInTheDocument();
  act(()=>{systemDark=true;listener();});
  expect(document.documentElement).toHaveClass('dark');
  fireEvent.click(screen.getByRole('button',{name:'Switch to light mode'}));
  expect(localStorage.getItem('placement-theme')).toBe('light');
  act(()=>listener());
  expect(document.documentElement).not.toHaveClass('dark');
  act(()=>setAppearance('system'));
  expect(document.documentElement).toHaveClass('dark');
});

it('applies explicit and cross-tab appearance choices without requiring a reload',()=>{
  localStorage.setItem('placement-theme','dark');
  render(<AppearanceProvider><ModeToggle/></AppearanceProvider>);
  expect(document.documentElement.style.colorScheme).toBe('dark');
  localStorage.setItem('placement-theme','light');
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'placement-theme'})));
  expect(screen.getByRole('button',{name:'Switch to dark mode'})).toBeInTheDocument();
  expect(document.documentElement).not.toHaveClass('dark');
});

function luminance(hex:string){return hex.match(/[a-f\d]{2}/gi)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
it('keeps essential text and action pairs legible in both theme definitions',()=>{
  for(const selector of [':root','.dark']){
    const block=css.slice(css.indexOf(selector+' {')).split('}')[0];
    const token=(name:string)=>new RegExp('--'+name+':\\s*(#[a-f\\d]{6})','i').exec(block)![1];
    expect(contrast(token('foreground'),token('card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('muted-foreground'),token('card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('primary-foreground'),token('primary'))).toBeGreaterThanOrEqual(4.5);
  }
  expect(css).toContain('prefers-reduced-transparency');
  expect(css).toContain('prefers-reduced-motion');
  expect(css).toContain('prefers-contrast');
});

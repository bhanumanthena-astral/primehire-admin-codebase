import {useEffect,useState} from 'react';

export type TableColumnOption = {key:string;label:string;required?:boolean};
type Layout = {version:1;order:string[];hidden:string[]};
export function normalizeColumnLayout(columns:readonly TableColumnOption[],value:unknown):Layout {
  const defaults=columns.map(column=>column.key);
  const saved=value&&typeof value==='object'&&'version' in value&&value.version===1?value as Partial<Layout>:{};
  const order=[...new Set([...(Array.isArray(saved.order)?saved.order.filter(key=>typeof key==='string'&&defaults.includes(key)):[]),...defaults])];
  const hidden=Array.isArray(saved.hidden)?[...new Set(saved.hidden.filter(key=>columns.some(column=>column.key===key&&!column.required)))]:[];
  return {version:1,order,hidden};
}
function load(columns:readonly TableColumnOption[],key?:string){try{return normalizeColumnLayout(columns,key?JSON.parse(localStorage.getItem(key)||'null'):null);}catch{return normalizeColumnLayout(columns,null);}}

export function useTableColumnSettings(columns:readonly TableColumnOption[],storageKey?:string){
  const [state,setState]=useState(()=>({storageKey,layout:load(columns,storageKey)}));
  const layout=state.storageKey===storageKey?state.layout:load(columns,storageKey);
  useEffect(()=>{setState({storageKey,layout:load(columns,storageKey)});},[storageKey,columns]);
  function save(value:Layout){const next=normalizeColumnLayout(columns,value);setState({storageKey,layout:next});if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* Keep the chosen layout usable when browser storage is unavailable. */}}
  const ordered=layout.order.map(key=>columns.find(column=>column.key===key)!);
  return {ordered,visible:ordered.filter(column=>!layout.hidden.includes(column.key)),hidden:layout.hidden,
    toggle:(key:string)=>save({...layout,hidden:layout.hidden.includes(key)?layout.hidden.filter(value=>value!==key):[...layout.hidden,key]}),
    move:(key:string,direction:-1|1)=>{const order=[...layout.order],index=order.indexOf(key),target=index+direction;if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];save({...layout,order});},
    reset:()=>save(normalizeColumnLayout(columns,null))};
}

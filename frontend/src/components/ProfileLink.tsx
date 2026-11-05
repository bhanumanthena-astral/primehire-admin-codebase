import {Link} from 'react-router-dom';
import {UserRound} from 'lucide-react';
export function ProfileLink({fullWidth=false}:{fullWidth?:boolean}){return <Link to="/account/profile" aria-label="Account profile" className={`inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 ${fullWidth?'w-full':''}`}><UserRound size={17}/><span>Account profile</span></Link>;}

import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ProfilePage} from './ProfilePage';
import {useAuth} from '../lib/authContext';
import {googleRequest} from '../lib/googleApi';
import {authFetch} from '../lib/authFetch';
vi.mock('../lib/authContext',()=>({useAuth:vi.fn()}));
vi.mock('../lib/googleApi',()=>({googleRequest:vi.fn(),followGoogle:vi.fn()}));
vi.mock('../lib/authFetch',()=>({authFetch:vi.fn()}));
vi.mock('../components/StaticTeamAvatar',()=>({StaticTeamAvatar:({role}:{role:string})=><div role="img" aria-label={role}/>,teamRoleLabel:(role:string)=>role==='hr'?'HR professional':role,avatarRole:(role:string)=>role==='admin'?'admin':role==='managerial_interviewer'?'manager':'hr'}));
const user={userId:'test',orgId:'test',name:'Test HR',email:'test@example.test',role:'hr',mfaEnabled:false,isActive:true};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(useAuth).mockReturnValue({user,impersonatingUser:null,logout:vi.fn()} as any);vi.mocked(googleRequest).mockResolvedValue({enabled:true,connected:false,status:'not_connected',calendar:'primary'});});
function open(){render(<MemoryRouter><ProfilePage/></MemoryRouter>);}
it('shows real account details and an authenticated Google connector',async()=>{open();expect(screen.getByRole('heading',{level:1,name:'Account profile.'})).toBeVisible();expect(screen.getAllByText('test@example.test')).toHaveLength(2);expect(await screen.findByRole('button',{name:'Connect Google account'})).toBeEnabled();expect(googleRequest).toHaveBeenCalledWith('',undefined,'GET',expect.any(AbortSignal));});
it('returns Google consent to the profile rather than starting public sign-in',async()=>{vi.mocked(googleRequest).mockImplementation(async(path)=>path==='/connect'?{authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth'} as any:{enabled:true,connected:false,status:'not_connected',calendar:'primary'});open();fireEvent.click(await screen.findByRole('button',{name:'Connect Google account'}));await waitFor(()=>expect(googleRequest).toHaveBeenCalledWith('/connect',{returnTo:'/account/profile'},'POST',expect.any(AbortSignal)));});
it('does not pretend Google works before administrator setup',async()=>{vi.mocked(googleRequest).mockResolvedValue({enabled:false,connected:false,status:'not_connected'});open();expect(await screen.findByText(/awaiting administrator setup/)).toBeVisible();expect(screen.getByRole('button',{name:'Connect Google account'})).toBeDisabled();});
it('changes only the current users password through the existing endpoint',async()=>{vi.mocked(authFetch).mockResolvedValue(new Response('{"ok":true}'));open();fireEvent.click(screen.getByRole('button',{name:'Password & security'}));fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'Synthetic-old-123!'}});fireEvent.change(screen.getByLabelText('New password',{exact:true}),{target:{value:'Synthetic-new-123!'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'Synthetic-new-123!'}});fireEvent.click(screen.getByRole('button',{name:'Update password'}));expect(await screen.findByText('Your password has been updated.')).toBeVisible();expect(authFetch).toHaveBeenCalledWith('/api/auth/change-password',expect.objectContaining({method:'POST',body:JSON.stringify({oldPassword:'Synthetic-old-123!',newPassword:'Synthetic-new-123!'})}));});

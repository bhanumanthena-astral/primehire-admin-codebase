import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it} from 'vitest';
import {StaticTeamAvatar,avatarRole} from './StaticTeamAvatar';

it.each([['hr','HR professional','hr-static.png'],['manager','Manager','admin-male-static.png'],['developer','Developer','developer-static.png'],['admin','Administrator','admin-male-static.png']] as const)('uses a static image for %s', (role,label,file)=>{
 const {container}=render(<StaticTeamAvatar role={role}/>);
 expect(screen.getByRole('img',{name:`${label} illustration`})).toHaveAttribute('src',`/images/team/${file}`);
 expect(container.querySelector('canvas')).toBeNull();
});
it('assigns the correct picture from the stored account role',()=>{expect(avatarRole('super_admin')).toBe('admin');expect(avatarRole('managerial_interviewer')).toBe('manager');expect(avatarRole('technical_interviewer')).toBe('developer');expect(avatarRole('hr')).toBe('hr');expect(avatarRole('recruiter')).toBe('member');expect(avatarRole('viewer')).toBe('member');});
it('shows accessible initials if an image fails to load',()=>{render(<StaticTeamAvatar role="hr"/>);fireEvent.error(screen.getByRole('img',{name:'HR professional illustration'}));expect(screen.getByRole('img',{name:'HR professional illustration'})).toHaveTextContent('HR');});

it('uses the requested picture specifically for Bhanus administrator account',()=>{render(<StaticTeamAvatar role="admin" accountId="4b9e2e41-c708-40c3-8aeb-361c5cbd91df"/>);expect(screen.getByRole('img',{name:'Administrator illustration'})).toHaveAttribute('src','/images/team/bhanu-static.png');});

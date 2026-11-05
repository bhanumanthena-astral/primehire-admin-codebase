import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {expect,it} from 'vitest';
import {ProfileLink} from './ProfileLink';
it('opens a separate account profile route from the visible account entry',async()=>{
 render(<MemoryRouter><Routes><Route path="/" element={<ProfileLink fullWidth/>}/><Route path="/account/profile" element={<h1>Dedicated account page</h1>}/></Routes></MemoryRouter>);
 expect(screen.getByRole('link',{name:'Account profile'})).toHaveAttribute('href','/account/profile');
 fireEvent.click(screen.getByRole('link',{name:'Account profile'}));
 expect(await screen.findByRole('heading',{name:'Dedicated account page'})).toBeVisible();
});

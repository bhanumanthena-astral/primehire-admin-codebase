import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {VideoPlayer} from '@/components/ui/video-player';
it('loads on play and exposes accessible playback controls',()=>{
 const request=vi.fn();const view=render(<VideoPlayer label="Candidate response" onRequest={request}/>);
 fireEvent.click(screen.getByRole('button',{name:'Play video'}));expect(request).toHaveBeenCalledTimes(1);
 view.rerender(<VideoPlayer src="blob:test" label="Candidate response"/>);
 const video=screen.getByLabelText('Candidate response') as HTMLVideoElement;
 expect(video).toHaveAttribute('preload','auto');
 expect(video).not.toHaveAttribute('autoplay');
 video.play=vi.fn().mockResolvedValue(undefined);video.pause=vi.fn();
 fireEvent.click(screen.getByRole('button',{name:'Play video'}));expect(video.play).toHaveBeenCalledTimes(1);
 Object.defineProperty(video,'duration',{value:120,configurable:true});fireEvent.durationChange(video);
 fireEvent.change(screen.getByRole('slider',{name:'Seek video'}),{target:{value:'35'}});expect(video.currentTime).toBe(35);
 fireEvent.click(screen.getByRole('button',{name:'Mute'}));expect(video.muted).toBe(true);
 expect(screen.getByRole('button',{name:'Fullscreen video'})).toBeEnabled();
 fireEvent.play(video);expect(screen.getByRole('button',{name:'Pause'})).toBeVisible();
});
it('keeps failed recordings retryable',()=>{
 render(<VideoPlayer src="blob:test" label="Candidate response"/>);
 const video=screen.getByLabelText('Candidate response') as HTMLVideoElement;
 video.load=vi.fn();video.play=vi.fn().mockResolvedValue(undefined);
 fireEvent.error(video);expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
 fireEvent.click(screen.getByRole('button',{name:'Retry video'}));expect(video.load).toHaveBeenCalledOnce();
});

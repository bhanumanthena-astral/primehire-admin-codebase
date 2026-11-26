import {useSyncExternalStore} from 'react';

const EVENT = 'elite:profile-appearance';
export type ProfileAppearance = {image?: string};
const key = (id: string) => `elite:profile-appearance:${id}`;
function read(id?: string) {
  try { return id ? localStorage.getItem(key(id)) : null; } catch { return null; }
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
export function useProfileAppearance(id?: string): ProfileAppearance {
  const raw = useSyncExternalStore(subscribe, () => read(id), () => null);
  try {
    const value = JSON.parse(raw || '{}');
    return {image: typeof value.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value.image) ? value.image : undefined};
  } catch { return {}; }
}
export function saveProfileAppearance(id: string, value: ProfileAppearance) {
  localStorage.setItem(key(id), JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
}

export async function prepareProfileImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image could not be read.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not prepare this image.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 512, 512);
    return canvas.toDataURL('image/webp', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

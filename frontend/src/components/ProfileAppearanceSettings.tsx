import {useRef, useState} from 'react';
import {toast} from 'sonner';
import {useAuth} from '../lib/authContext';
import {prepareProfileImage, saveProfileAppearance, useProfileAppearance} from '../lib/profileAppearance';
import {StaticTeamAvatar, avatarRole} from './StaticTeamAvatar';
import StatusMark from './reactbits/StatusMark';

export function ProfileAppearanceSettings() {
  const {user, impersonatingUser} = useAuth();
  const preferences = useProfileAppearance(user?.userId);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const activeAccount = useRef(user?.userId);
  activeAccount.current = user?.userId;
  if (!user) return null;
  function save(value: typeof preferences, message: string) {
    try { saveProfileAppearance(user!.userId, value); toast.success(message); }
    catch { toast.error('Could not save your appearance. Browser storage may be full or unavailable.'); }
  }
  async function upload(file?: File) {
    if (!file) return;
    const id = user!.userId;
    setBusy(true);
    try {
      const image = await prepareProfileImage(file);
      if (activeAccount.current === id) save({...preferences, image}, 'Profile image updated.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not read this image. Try another file.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <section className="profile-section" aria-labelledby="appearance-title">
    <div className="profile-section-title"><div><h2 id="appearance-title">Profile image</h2><p>Make your workspace feel like yours.</p></div></div>
    <div className="flex flex-wrap items-center gap-4">
      <StaticTeamAvatar accountId={user.userId} role={avatarRole(user.role)} portrait className="size-24 overflow-hidden rounded-2xl"/>
      <div className="space-y-3"><p className="text-sm text-muted-foreground">Your generated portrait is the default. PNG, JPEG or WebP, up to 5 MB.</p>
        <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Custom profile image" disabled={busy || !!impersonatingUser} onChange={e=>void upload(e.target.files?.[0])}/>
        <div className="flex flex-wrap gap-2"><button type="button" className="profile-primary" disabled={busy || !!impersonatingUser} onClick={()=>input.current?.click()}>{busy?<StatusMark status="running" label="Preparing image…"/>:'Upload image'}</button>
          <button type="button" className="profile-secondary" disabled={busy || !preferences.image || !!impersonatingUser} onClick={()=>save({...preferences, image: undefined}, 'Default portrait restored.')}>Restore default</button></div>
      </div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Appearance is saved for your account in this browser.</p>
  </section>;
}

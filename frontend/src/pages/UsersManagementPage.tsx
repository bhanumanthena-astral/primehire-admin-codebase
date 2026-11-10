import {Button} from '@/components/ui/button';
import {Table, TableHeader, TableRow, TableHead, TableBody, TableCell} from '@/components/ui/table';
import {Input} from '@/components/ui/input';
import {AppSelect} from '@/src/components/ui/AppSelect';
import {Textarea} from '@/components/ui/textarea';
import {Modal} from '../components/ui/Modal';
import {JobAccessEditor} from '../components/JobAccessControls';
import {JobAccess,defaultJobAccess,isJobAdmin} from '../lib/jobAccess';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/authContext';
import { authFetch } from '../lib/authFetch';
import { teamInvitationUrl } from '../lib/teamInvitation';
import {StaticTeamAvatar,avatarRole,teamRoleLabel} from '../components/StaticTeamAvatar';
import { User, Role } from '../lib/authTypes';
import {
  Users,
  UserPlus,
  Shield,
  Eye,
  Trash2,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';

export const UsersManagementPage: React.FC = () => {
  const { user: currentUser, viewAs } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('hr');
  const [inviteAccess,setInviteAccess]=useState<JobAccess[]>(['view','upload']);
  const [accessUser,setAccessUser]=useState<User|null>(null);
  const [userAccess,setUserAccess]=useState<JobAccess[]>([]);
  const [accessSaving,setAccessSaving]=useState(false);
  const [accessError,setAccessError]=useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // View-as modal state
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [viewAsReason, setViewAsReason] = useState('');
  const [viewAsLoading, setViewAsLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/users');
      if (!res.ok) {
        throw new Error('Failed to load users');
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Error loading users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName,
          role: inviteRole,
          jobAccess: inviteAccess,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Failed to invite user' }));
        throw new Error(errData.detail || 'Failed to invite user');
      }

      const data = await res.json();
      const fullInviteUrl = teamInvitationUrl(data.inviteUrl);
      setInviteUrl(fullInviteUrl);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to invite user');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleToggleActive = async (target: User) => {
    try {
      const res = await authFetch(`/api/users/${target.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !target.isActive }),
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      // Ignore
    }
  };

  const reissueInvite = async (target: User) => {
    setError(null);
    try {
      const res = await authFetch(`/api/users/${target.userId}/invite`, {method:'POST'});
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create invitation');
      setInviteEmail(target.email);
      setInviteName(target.name);
      setInviteUrl(teamInvitationUrl(data.inviteUrl));
      setCopied(false);
      setShowInviteModal(true);
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      const res = await authFetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      // Ignore
    }
  };

  const handleConfirmViewAs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;
    setViewAsLoading(true);
    try {
      await viewAs(targetUser.userId, viewAsReason);
      setTargetUser(null);
      setViewAsReason('');
    } catch (err: any) {
      alert(err.message || 'Failed to switch view');
    } finally {
      setViewAsLoading(false);
    }
  };

  const copyInviteToClipboard = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {accessUser&&<Modal onClose={()=>setAccessUser(null)} dismissible={!accessSaving} labelledBy="team-access-title"><h2 id="team-access-title" className="text-xl font-bold">Access for {accessUser.name}</h2><p className="my-4 text-sm text-muted-foreground">Choose what this person can do in their assigned jobs.</p><JobAccessEditor value={userAccess} onChange={setUserAccess} allowed={defaultJobAccess(accessUser.role)}/>{accessError&&<p role="alert" className="mt-3 text-sm text-destructive">{accessError}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="ghost" className="rounded-lg border border-border px-4 py-2 text-sm" disabled={accessSaving} onClick={()=>setAccessUser(null)}>Cancel</Button><Button variant="ghost" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" disabled={accessSaving} onClick={async()=>{setAccessSaving(true);try{const r=await authFetch(`/api/users/${accessUser.userId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobAccess:userAccess})});if(!r.ok){const d=await r.json();throw new Error(d.detail||'Could not update access');}setAccessUser(null);void fetchUsers();}catch(e){setAccessError(e instanceof Error?e.message:'Could not update access');}finally{setAccessSaving(false);}}}>{accessSaving?'Saving…':'Save access'}</Button></div></Modal>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5 border-border dark:border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white flex items-center gap-2.5">
            <Users className="h-6 w-6 text-warning dark:text-warning" />
            Team & User Management
          </h1>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground mt-1">
            Manage your organization members, assign roles, and issue invitation links.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost"
            onClick={fetchUsers}
            disabled={loading}
            className="p-2 border border-border dark:border-border rounded-lg hover:bg-muted dark:hover:bg-muted text-muted-foreground dark:text-muted-foreground transition-colors"
            title="Refresh users"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost"
            onClick={() => {
              setShowInviteModal(true);
              setInviteUrl(null);
              setInviteEmail('');
              setInviteName('');
              setInviteRole('hr');setInviteAccess(['view','upload']);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-warning hover:bg-primary text-primary-foreground rounded-lg text-sm font-medium shadow-sm transition-all"
          >
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[var(--destructive-soft)] dark:bg-[var(--destructive-soft)]/30 border border-destructive/30 dark:border-destructive/50 rounded-xl text-destructive dark:text-destructive text-sm flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Users table */}
      <div className="bg-card dark:bg-card border border-border dark:border-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2 text-warning" />
            <span>Loading members...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center p-12 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 text-muted-foreground dark:text-foreground" />
            <p>No users found in this organization.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <TableHeader className="bg-background dark:bg-background/50 border-b border-border dark:border-border text-muted-foreground dark:text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                <TableRow>
                  <TableHead className="px-6 py-3.5">Name / Email</TableHead>
                  <TableHead className="px-6 py-3.5">Role</TableHead>
                  <TableHead className="px-6 py-3.5">MFA</TableHead>
                  <TableHead className="px-6 py-3.5">Status</TableHead>
                  <TableHead className="px-6 py-3.5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <TableRow key={u.userId} className="hover:bg-background/50 dark:hover:bg-muted/50 transition-colors">
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3"><StaticTeamAvatar accountId={u.userId} role={avatarRole(u.role)} portrait className="team-member-picture"/><div><div className="font-medium text-foreground dark:text-white">{u.name}</div>
                      <div className="text-xs text-muted-foreground dark:text-muted-foreground">{u.email}</div></div></div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted dark:bg-card text-foreground dark:text-muted-foreground capitalize">
                        <Shield className="h-3 w-3 text-warning" />
                        {teamRoleLabel(u.role)}
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      {u.mfaEnabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success dark:text-success font-medium">
                          <CheckCircle className="h-3.5 w-3.5" /> Enabled
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Off</span>
                      )}
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.isActive
                            ? 'bg-[var(--success-soft)] text-success dark:bg-[var(--success-soft)]/40 dark:text-success'
                            : 'bg-[var(--destructive-soft)] text-destructive dark:bg-[var(--destructive-soft)]/40 dark:text-destructive'
                        }`}
                      >
                        {u.isActive ? (u.passwordSetupRequired ? 'Awaiting password' : 'Active') : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-right space-x-2">
                      {!isJobAdmin(u)&&<Button variant="ghost" className="text-xs font-bold underline" onClick={()=>{setAccessError('');setAccessUser(u);setUserAccess(u.jobAccess??defaultJobAccess(u.role));}}>Access</Button>}
                      {u.isActive && u.passwordSetupRequired && <Button variant="ghost" className="text-xs underline" onClick={() => reissueInvite(u)}>New invitation</Button>}
                      {currentUser?.role === 'super_admin' && u.userId !== currentUser.userId && (
                        <Button variant="ghost"
                          onClick={() => setTargetUser(u)}
                          className="px-2.5 py-1 text-xs font-medium text-warning dark:text-warning hover:bg-[var(--warning-soft)] dark:hover:bg-[var(--warning-soft)]/50 rounded border border-warning/30 dark:border-warning/30 inline-flex items-center gap-1 transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View As
                        </Button>
                      )}
                      {u.userId !== currentUser?.userId && (
                        <>
                          <Button variant="ghost"
                            onClick={() => handleToggleActive(u)}
                            className="p-1 text-muted-foreground hover:text-muted-foreground dark:hover:text-slate-200 rounded"
                            title={u.isActive ? 'Deactivate user' : 'Activate user'}
                          >
                            {u.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost"
                            onClick={() => handleDelete(u.userId)}
                            className="p-1 text-muted-foreground hover:text-destructive rounded"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <Modal onClose={() => setShowInviteModal(false)} label="Invite Team Member" dismissible={!inviteLoading} className="max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground dark:text-white">Invite Team Member</h2>

            {!inviteUrl ? (
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground dark:text-muted-foreground mb-1">
                    Full Name
                  </label>
                  <Input
                    type="text"
                    required
                    aria-label="Full name"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-background dark:bg-background dark:border-border text-foreground dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground dark:text-muted-foreground mb-1">
                    Email Address
                  </label>
                  <Input
                    type="email"
                    required
                    aria-label="Email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-background dark:bg-background dark:border-border text-foreground dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground dark:text-muted-foreground mb-1">
                    Role
                  </label>
                  <AppSelect
                    aria-label="Role"
                    value={inviteRole}
                    onValueChange={(e) => {const role=e as Role;setInviteRole(role);setInviteAccess(['hr','recruiter'].includes(role)?['view','upload']:defaultJobAccess(role));}}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-background dark:bg-background dark:border-border text-foreground dark:text-white"
                  >
                    <option value="hr">HR</option>
                    <option value="recruiter">Recruiter</option><option value="viewer">Read-only User</option>
                    <option value="technical_interviewer">Developer (Technical Interviewer)</option>
                    <option value="managerial_interviewer">Manager (Managerial Interviewer)</option>
                    <option value="leadership">Leadership (Hiring Intelligence)</option>
                    {currentUser?.role === 'super_admin' && <option value="admin">Admin</option>}
                    {currentUser?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </AppSelect>
                </div>

                {inviteRole==='leadership'?<p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">Dedicated leadership dashboard with read-only hiring metrics. Candidate contacts, review comments and operational controls are not included.</p>:<JobAccessEditor value={inviteAccess} onChange={setInviteAccess} allowed={defaultJobAccess(inviteRole)} disabled={['admin','super_admin'].includes(inviteRole)}/>}
                <div className="flex justify-end gap-2.5 pt-2">
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    disabled={inviteLoading}
                    className="px-4 py-2 border rounded-lg text-sm font-medium text-muted-foreground hover:bg-background dark:text-muted-foreground dark:hover:bg-muted"
                  >
                    Cancel
                  </Button>
                  <Button variant="ghost"
                    type="submit"
                    disabled={inviteLoading}
                    className="px-4 py-2 bg-warning hover:bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {inviteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Generate Invitation
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-[var(--success-soft)] dark:bg-[var(--success-soft)]/40 border border-success/30 dark:border-success/30 rounded-xl text-success dark:text-success text-xs">
                  Invitation created! Copy the link below and share it with {inviteName}:
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={inviteUrl}
                    className="w-full px-3 py-2 bg-muted dark:bg-background border border-input dark:border-border rounded-lg text-xs font-mono text-foreground dark:text-muted-foreground truncate"
                  />
                  <Button variant="ghost"
                    onClick={copyInviteToClipboard}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-warning flex items-center gap-1 shrink-0"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="ghost"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-glow"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
        </Modal>
      )}

      {/* SuperAdmin View-As Confirmation Modal */}
      {targetUser && (
        <Modal onClose={() => setTargetUser(null)} label="Impersonate User" dismissible={!viewAsLoading} className="max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground dark:text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-warning" />
              Impersonate User
            </h2>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              You are about to switch to the view of <strong className="text-foreground dark:text-foreground">{targetUser.name}</strong> ({targetUser.email}).
              Per security policy, all view-as actions are audited and operate in read-only mode.
            </p>

            <form onSubmit={handleConfirmViewAs} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground dark:text-muted-foreground mb-1">
                  Reason for Impersonation (Required for audit log)
                </label>
                <Textarea
                  required
                  rows={3}
                  value={viewAsReason}
                  onChange={(e) => setViewAsReason(e.target.value)}
                  placeholder="e.g. Investigating issue with candidate assignment visibility reported in ticket #1234"
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-background dark:bg-background dark:border-border text-foreground dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button variant="ghost"
                  type="button"
                  onClick={() => setTargetUser(null)}
                  disabled={viewAsLoading}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-muted-foreground hover:bg-background dark:text-muted-foreground dark:hover:bg-muted"
                >
                  Cancel
                </Button>
                <Button variant="ghost"
                  type="submit"
                  disabled={viewAsLoading || viewAsReason.trim().length < 5}
                  className="px-4 py-2 bg-warning hover:bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {viewAsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm & View As
                </Button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  );
};

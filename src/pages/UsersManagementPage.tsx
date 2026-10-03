import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/authContext';
import { authFetch } from '../lib/authFetch';
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
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Failed to invite user' }));
        throw new Error(errData.detail || 'Failed to invite user');
      }

      const data = await res.json();
      const fullInviteUrl = `${window.location.origin}${data.inviteUrl}`;
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5 border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Users className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            Team & User Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your organization members, assign roles, and issue invitation links.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh users"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => {
              setShowInviteModal(true);
              setInviteUrl(null);
              setInviteEmail('');
              setInviteName('');
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium shadow-sm transition-all"
          >
            <UserPlus className="h-4 w-4" />
            Invite Member
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2 text-amber-600" />
            <span>Loading members...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center p-12 text-slate-400">
            <Users className="h-10 w-10 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
            <p>No users found in this organization.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Name / Email</th>
                  <th className="px-6 py-3.5">Role</th>
                  <th className="px-6 py-3.5">MFA</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.userId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-white">{u.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                        <Shield className="h-3 w-3 text-amber-500" />
                        {u.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {u.mfaEnabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle className="h-3.5 w-3.5" /> Enabled
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Off</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.isActive
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {currentUser?.role === 'super_admin' && u.userId !== currentUser.userId && (
                        <button
                          onClick={() => setTargetUser(u)}
                          className="px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded border border-amber-200 dark:border-amber-900 inline-flex items-center gap-1 transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View As
                        </button>
                      )}
                      {u.userId !== currentUser?.userId && (
                        <>
                          <button
                            onClick={() => handleToggleActive(u)}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                            title={u.isActive ? 'Deactivate user' : 'Activate user'}
                          >
                            {u.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => handleDelete(u.userId)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Invite Team Member</h2>

            {!inviteUrl ? (
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 dark:bg-slate-950 dark:border-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 dark:bg-slate-950 dark:border-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 dark:bg-slate-950 dark:border-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="hr">HR</option>
                    <option value="technical_interviewer">Technical Interviewer</option>
                    <option value="managerial_interviewer">Managerial Interviewer</option>
                    {currentUser?.role === 'super_admin' && <option value="admin">Admin</option>}
                    {currentUser?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {inviteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Generate Invitation
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs">
                  Invitation created! Copy the link below and share it with {inviteName}:
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteUrl}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-xs font-mono text-slate-700 dark:text-slate-300 truncate"
                  />
                  <button
                    onClick={copyInviteToClipboard}
                    className="px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-500 flex items-center gap-1 shrink-0"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SuperAdmin View-As Confirmation Modal */}
      {targetUser && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-amber-600" />
              Impersonate User
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              You are about to switch to the view of <strong className="text-slate-700 dark:text-slate-200">{targetUser.name}</strong> ({targetUser.email}).
              Per security policy, all view-as actions are audited and operate in read-only mode.
            </p>

            <form onSubmit={handleConfirmViewAs} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Reason for Impersonation (Required for audit log)
                </label>
                <textarea
                  required
                  rows={3}
                  value={viewAsReason}
                  onChange={(e) => setViewAsReason(e.target.value)}
                  placeholder="e.g. Investigating issue with candidate assignment visibility reported in ticket #1234"
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 dark:bg-slate-950 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetUser(null)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={viewAsLoading || viewAsReason.trim().length < 5}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {viewAsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm & View As
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

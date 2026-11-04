import {User} from './authTypes';
import {Job} from './hiringApi';
export type JobAccess = 'view' | 'edit' | 'create' | 'upload';
export const isJobAdmin = (user?: Pick<User,'role'> | null) => ['admin','super_admin'].includes(user?.role || '');
export function defaultJobAccess(role: string): JobAccess[] {
  return ['hr','recruiter','admin','super_admin'].includes(role) ? ['view','edit','create','upload'] : role === 'viewer' ? ['view'] : [];
}
export function hasJobAccess(user: User | null | undefined, access: JobAccess, job?: Job) {
  if (isJobAdmin(user)) return true;
  if (!defaultJobAccess(user?.role || '').includes(access)) return false;
  if (job?.assigneeUserId && user?.userId && job.assigneeUserId !== user.userId) return false;
  const allowed = user?.jobAccess ?? defaultJobAccess(user?.role || '');
  if (!allowed.includes(access)) return false;
  if (job?.assigneeAccess && access !== 'create' && !job.assigneeAccess.includes(access)) return false;
  if (job && ['edit','upload'].includes(access) && job.lifecycleStatus !== 'OPEN') return false;
  return true;
}
export function acceptsResumes(job: Job) {
  return job.lifecycleStatus === 'OPEN' && job.acceptingApplications !== false &&
    (job.positionsRemaining == null || job.positionsRemaining > 0) &&
    (!job.closesAt || new Date(job.closesAt).getTime() > Date.now());
}

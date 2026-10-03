export type Role =
  | 'super_admin'
  | 'admin'
  | 'hr'
  | 'technical_interviewer'
  | 'managerial_interviewer';

export interface User {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  deviceInfo: string;
  isCurrent: boolean;
}

export interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  impersonatingUser: User | null;
  login: (email: string, password: string, orgId?: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  viewAs: (targetUserId: string, reason: string) => Promise<void>;
  exitViewAs: () => void;
  refreshUser: () => Promise<void>;
}

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthContextType, User } from './authTypes';
import { authFetch, getAccessToken, setAccessToken, setAuthFailureHandler } from './authFetch';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [impersonatingUser, setImpersonatingUser] = useState<User | null>(null);
  const [originalToken, setOriginalToken] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await authFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return data;
      } else {
        setUser(null);
        setAccessToken(null);
        setTokenState(null);
        return null;
      }
    } catch {
      setUser(null);
      setAccessToken(null);
      setTokenState(null);
      return null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  // Initial bootstrap: try refreshing token using httpOnly cookie
  useEffect(() => {
    let mounted = true;

    setAuthFailureHandler(() => {
      if (mounted) {
        setUser(null);
        setTokenState(null);
        setImpersonatingUser(null);
      }
    });

    const initAuth = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setAccessToken(data.accessToken);
          setTokenState(data.accessToken);
          setUser(data.user);
        } else if (mounted) {
          setUser(null);
          setAccessToken(null);
          setTokenState(null);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setAccessToken(null);
          setTokenState(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string, orgId?: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, orgId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }

    const data = await res.json();
    if (data.mfaRequired) {
      return { mfaRequired: true, mfaToken: data.mfaToken };
    }

    setAccessToken(data.accessToken);
    setTokenState(data.accessToken);
    setUser(data.user);
    return {};
  };

  const verifyMfa = async (mfaToken: string, code: string) => {
    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'MFA verification failed' }));
      throw new Error(err.detail || 'MFA verification failed');
    }

    const data = await res.json();
    setAccessToken(data.accessToken);
    setTokenState(data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      setAccessToken(null);
      setTokenState(null);
      setUser(null);
      setImpersonatingUser(null);
      setOriginalToken(null);
    }
  };

  const viewAs = async (targetUserId: string, reason: string) => {
    const currentTok = getAccessToken();
    const res = await authFetch('/api/auth/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId, reason }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to switch view' }));
      throw new Error(err.detail || 'Failed to switch view');
    }

    const data = await res.json();
    setOriginalToken(currentTok);
    setAccessToken(data.accessToken);
    setTokenState(data.accessToken);
    setImpersonatingUser(data.impersonating);
  };

  const exitViewAs = () => {
    if (originalToken) {
      setAccessToken(originalToken);
      setTokenState(originalToken);
      setOriginalToken(null);
      setImpersonatingUser(null);
      fetchProfile();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken: token,
        loading,
        impersonatingUser,
        login,
        verifyMfa,
        logout,
        viewAs,
        exitViewAs,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

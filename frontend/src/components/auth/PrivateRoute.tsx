import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {LoadingState} from '../ui/LoadingState';

export const PrivateRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background"><LoadingState compact label="Authenticating your session…" className="max-w-sm"/></div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};

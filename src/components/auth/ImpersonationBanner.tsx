import React from 'react';
import { useAuth } from '../../lib/authContext';
import { Eye, LogOut } from 'lucide-react';

export const ImpersonationBanner: React.FC = () => {
  const { impersonatingUser, exitViewAs } = useAuth();

  if (!impersonatingUser) return null;

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 text-sm font-medium flex items-center justify-between shadow-sm sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 animate-pulse text-amber-900" />
        <span>
          Viewing as <strong className="font-semibold">{impersonatingUser.name}</strong> ({impersonatingUser.role}) — Read-Only Session
        </span>
      </div>
      <button
        onClick={exitViewAs}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950 text-white rounded text-xs font-semibold hover:bg-black transition-colors"
      >
        <LogOut className="h-3 w-3" />
        Exit View
      </button>
    </div>
  );
};

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Plus, Sun } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { api } from '../lib/api';
import { applyTheme, useResolvedTheme } from '../lib/theme';
import { Logo } from './Logo';
import { IconButton } from './ui';

export function ThemeToggle() {
  const theme = useResolvedTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <IconButton label={next === 'light' ? 'Passer en thème clair' : 'Passer en thème sombre'} onClick={() => applyTheme(next)}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </IconButton>
  );
}

export function Layout({ authMode }: { authMode: 'password' | 'none' }) {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.resetQueries(),
  });

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Glaneur, accueil">
            <Logo size={30} />
            <span className="brand-name display">Glaneur</span>
          </Link>
          <nav className="nav" aria-label="Navigation principale">
            <NavLink to="/" end className="nav-link">
              Flux
            </NavLink>
            <NavLink to="/recipes" className="nav-link">
              Recettes
            </NavLink>
            <NavLink to="/settings" className="nav-link">
              Réglages
            </NavLink>
          </nav>
          <div className="topbar-actions">
            <Link to="/new" className="btn btn-primary btn-sm topbar-new">
              <Plus size={16} aria-hidden />
              <span>Nouveau flux</span>
            </Link>
            <ThemeToggle />
            {authMode === 'password' && (
              <IconButton label="Se déconnecter" onClick={() => logout.mutate()}>
                <LogOut size={18} />
              </IconButton>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}

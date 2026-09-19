import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Button, Spinner } from './components/ui';
import { api, onUnauthorized } from './lib/api';
import { useResolvedTheme } from './lib/theme';
import { AuthScreen } from './pages/AuthScreen';
import { Dashboard } from './pages/Dashboard';
import { EditorPage } from './pages/EditorPage';
import { FeedPage } from './pages/FeedPage';
import { NewFeed } from './pages/NewFeed';
import { RecipesPage } from './pages/RecipesPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const qc = useQueryClient();
  const theme = useResolvedTheme();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, staleTime: 60_000 });

  useEffect(() => {
    onUnauthorized(() => void qc.invalidateQueries({ queryKey: ['auth'] }));
  }, [qc]);

  const toaster = <Toaster position="bottom-right" theme={theme} toastOptions={{ className: 'toast' }} />;

  if (auth.isPending) {
    return (
      <div className="boot">
        <Spinner />
      </div>
    );
  }

  if (auth.isError) {
    return (
      <div className="boot">
        <p className="display boot-title">Glaneur ne répond pas</p>
        <p className="muted">{auth.error.message}</p>
        <Button icon={<RotateCw size={16} />} onClick={() => void auth.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!auth.data.authenticated) {
    return (
      <>
        {toaster}
        <AuthScreen setup={auth.data.setupRequired} />
      </>
    );
  }

  return (
    <>
      {toaster}
      <Routes>
        <Route element={<Layout authMode={auth.data.authMode} />}>
          <Route index element={<Dashboard />} />
          <Route path="new" element={<NewFeed />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="feeds/:id" element={<FeedPage />} />
        </Route>
        <Route path="editor" element={<EditorPage />} />
        <Route path="feeds/:id/edit" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ThemeToggle } from '../components/Layout';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';

export function AuthScreen({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = setup && confirm.length > 0 && confirm !== password;
  const tooShort = setup && password.length > 0 && password.length < 8;

  const mutation = useMutation({
    mutationFn: () => (setup ? api.setup(password) : api.login(password)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort || !password) return;
    mutation.mutate();
  };

  return (
    <div className="auth">
      <div className="auth-corner">
        <ThemeToggle />
      </div>
      <form className="auth-card card" onSubmit={submit}>
        <Logo size={46} />
        <div>
          <h1 className="display auth-title">
            {setup ? (
              <>
                Bienvenue sur <span className="marker">Glaneur</span>
              </>
            ) : (
              'Glaneur'
            )}
          </h1>
          <p className="muted auth-lede">
            {setup
              ? 'Choisissez le mot de passe qui protégera votre instance. Vous en êtes le seul utilisateur.'
              : 'Entrez votre mot de passe pour retrouver vos flux.'}
          </p>
        </div>
        <Field label="Mot de passe" htmlFor="auth-password" hint={setup ? '8 caractères minimum.' : undefined}>
          <Input
            id="auth-password"
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {setup && (
          <Field label="Confirmation" htmlFor="auth-confirm" hint={mismatch ? 'Les deux mots de passe ne correspondent pas.' : undefined}>
            <Input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        {mutation.error && (
          <p className="callout callout-error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={mutation.isPending} disabled={!password || mismatch || tooShort || (setup && !confirm)}>
          {setup ? 'Créer le mot de passe' : 'Se connecter'}
        </Button>
      </form>
    </div>
  );
}

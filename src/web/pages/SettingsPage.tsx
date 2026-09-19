import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AppSettings } from '../../shared/types';
import { Button, Dialog, Field, Input, Select, Spinner, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { REFRESH_CHOICES } from '../lib/fields';
import { formatBytes, formatNumber, plural } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      toast.success('Mot de passe modifié');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch && next.length >= 8) change.mutate();
  };
  return (
    <form className="settings-card card" onSubmit={submit}>
      <div className="settings-card-head">
        <h2 className="display settings-card-title">Mot de passe</h2>
        <p className="faint">Changer le mot de passe ferme les autres sessions ouvertes.</p>
      </div>
      <div className="settings-grid">
        <Field label="Mot de passe actuel" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div />
        <Field label="Nouveau mot de passe" htmlFor="pw-next" hint="8 caractères minimum.">
          <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmation" htmlFor="pw-confirm" hint={mismatch ? 'Les deux mots de passe ne correspondent pas.' : undefined}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      {change.error && <p className="callout callout-error">{change.error.message}</p>}
      <div className="settings-actions">
        <Button type="submit" loading={change.isPending} disabled={!current || next.length < 8 || mismatch || !confirm}>
          Changer le mot de passe
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  useDocumentTitle('Réglages');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const system = useQuery({ queryKey: ['system'], queryFn: api.system });
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, staleTime: 60_000 });
  const [form, setForm] = useState<AppSettings | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const afterSave = (s: AppSettings) => {
    qc.setQueryData(['settings'], s);
    void qc.invalidateQueries({ queryKey: ['feeds'] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };

  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.saveSettings(patch),
    onSuccess: (s) => {
      afterSave(s);
      toast.success('Réglages enregistrés');
    },
    onError: (err) => toast.error(err.message),
  });

  const rotate = useMutation({
    mutationFn: api.rotateKey,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      toast.success('Nouvelle clé générée : mettez à jour vos abonnements');
      setConfirmRotate(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const importFile = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      const result = await api.importFeeds(data);
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      if (result.errors.length) toast.warning(`${plural(result.imported, 'flux importé', 'flux importés')}, ${result.errors.length} ignoré(s)`, { description: result.errors.slice(0, 3).join(' · ') });
      else toast.success(plural(result.imported, 'flux importé', 'flux importés'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Fichier illisible : un export JSON de Glaneur est attendu.');
    }
  };

  if (settings.isPending || !form) {
    return (
      <div className="loading-block">
        <Spinner />
      </div>
    );
  }
  if (settings.isError) return <p className="callout callout-error">{settings.error.message}</p>;

  const saved = settings.data;
  const dirty =
    form.publicUrl !== saved.publicUrl ||
    form.defaultRefreshMinutes !== saved.defaultRefreshMinutes ||
    form.userAgent !== saved.userAgent ||
    form.acceptLanguage !== saved.acceptLanguage ||
    form.rsshubBase !== saved.rsshubBase;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const sys = system.data;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="display page-title">Réglages</h1>
          <p className="page-lede">Accès aux flux, récupération des pages et sauvegarde de votre configuration.</p>
        </div>
      </header>

      <div className="settings">
        <section className="settings-card card">
          <div className="settings-card-head">
            <h2 className="display settings-card-title">Accès aux flux</h2>
            <p className="faint">Les lecteurs de flux ne peuvent pas se connecter : une clé dans l’adresse les autorise à lire vos flux.</p>
          </div>
          <Toggle
            checked={saved.feedKeyRequired}
            disabled={save.isPending}
            onChange={(v) => save.mutate({ feedKeyRequired: v })}
            label="Exiger la clé d’accès"
            description={saved.feedKeyRequired ? 'Seules les adresses contenant la clé fonctionnent.' : 'Toute personne qui peut joindre ce serveur peut lire vos flux.'}
          />
          <Field label="Clé d’accès" htmlFor="feed-key">
            <div className="key-row">
              <Input id="feed-key" className="mono" readOnly value={saved.feedKey} onFocus={(e) => e.currentTarget.select()} />
              <Button
                icon={<Copy size={16} />}
                onClick={async () => ((await copyText(saved.feedKey)) ? toast.success('Clé copiée') : toast.error('Copie impossible'))}
              >
                Copier
              </Button>
              <Button variant="ghost" icon={<KeyRound size={16} />} onClick={() => setConfirmRotate(true)}>
                Régénérer
              </Button>
            </div>
          </Field>
        </section>

        <form
          className="settings-card card"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              publicUrl: form.publicUrl,
              defaultRefreshMinutes: form.defaultRefreshMinutes,
              userAgent: form.userAgent,
              acceptLanguage: form.acceptLanguage,
              rsshubBase: form.rsshubBase,
            });
          }}
        >
          <div className="settings-card-head">
            <h2 className="display settings-card-title">Récupération des pages</h2>
            <p className="faint">Valeurs utilisées par tous les flux, sauf réglage particulier dans l’éditeur.</p>
          </div>
          <Field label="Adresse publique de Glaneur" htmlFor="public-url" hint="Sert à construire les adresses des flux, par exemple derrière un proxy inverse. Laissez vide pour utiliser l’adresse courante.">
            <Input id="public-url" className="mono" placeholder="https://glaneur.maison.lan" value={form.publicUrl} onChange={(e) => set('publicUrl', e.target.value)} />
          </Field>
          <div className="settings-grid">
            <Field label="Fréquence par défaut" htmlFor="default-refresh">
              <Select id="default-refresh" value={form.defaultRefreshMinutes} onChange={(e) => set('defaultRefreshMinutes', Number(e.target.value))}>
                {REFRESH_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Langues acceptées" htmlFor="accept-language">
              <Input id="accept-language" className="mono" value={form.acceptLanguage} onChange={(e) => set('acceptLanguage', e.target.value)} />
            </Field>
          </div>
          <Field label="User-Agent" htmlFor="user-agent" hint="Certains sites refusent les robots : un navigateur courant passe mieux.">
            <Input id="user-agent" className="mono" value={form.userAgent} onChange={(e) => set('userAgent', e.target.value)} />
          </Field>
          <Field label="Instance RSSHub" htmlFor="rsshub" hint="Utilisée par la recette « Route RSSHub ». Idéalement votre propre instance.">
            <Input id="rsshub" className="mono" value={form.rsshubBase} onChange={(e) => set('rsshubBase', e.target.value)} />
          </Field>
          <div className="settings-actions">
            <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
              Enregistrer les modifications
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setForm(saved)}>
                Annuler
              </Button>
            )}
          </div>
        </form>

        {auth.data?.authMode === 'password' && <PasswordCard />}

        <section className="settings-card card">
          <div className="settings-card-head">
            <h2 className="display settings-card-title">Sauvegarde</h2>
            <p className="faint">L’export contient la configuration de tous vos flux (sans les articles). L’OPML sert à importer vos flux dans un lecteur.</p>
          </div>
          <div className="settings-actions">
            <a className="btn btn-secondary" href="/api/export" download>
              <Download size={16} aria-hidden />
              <span>Exporter la configuration</span>
            </a>
            <label className="btn btn-secondary">
              <Upload size={16} aria-hidden />
              <span>Importer un export</span>
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <a className="btn btn-ghost" href="/api/opml" download>
              <Download size={16} aria-hidden />
              <span>Exporter en OPML</span>
            </a>
          </div>
        </section>

        <section className="settings-card card">
          <div className="settings-card-head">
            <h2 className="display settings-card-title">Système</h2>
          </div>
          {sys ? (
            <dl className="sysinfo">
              <dt>Version</dt>
              <dd className="mono">Glaneur {sys.version}</dd>
              <dt>Node.js</dt>
              <dd className="mono">{sys.node}</dd>
              <dt>Rendu JavaScript</dt>
              <dd>
                {sys.browser.available ? (
                  <>
                    Disponible <span className="mono faint">({sys.browser.path})</span>
                  </>
                ) : (
                  <>
                    Indisponible — installez Chromium sur le serveur (<span className="mono">apt install chromium</span>) puis redémarrez Glaneur.
                  </>
                )}
              </dd>
              <dt>Authentification</dt>
              <dd>{sys.authMode === 'password' ? 'Mot de passe' : 'Désactivée (GLANEUR_AUTH=none)'}</dd>
              <dt>Données</dt>
              <dd className="mono">{sys.dataDir}</dd>
              <dt>Base de données</dt>
              <dd>
                {formatBytes(sys.dbSizeBytes)} · {plural(sys.feeds, 'flux', 'flux')} · {formatNumber(sys.items)} articles
              </dd>
              <dt>En service depuis</dt>
              <dd>{formatUptime(sys.uptimeSec)}</dd>
            </dl>
          ) : (
            <Spinner />
          )}
        </section>
      </div>

      <Dialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Régénérer la clé ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
              Annuler
            </Button>
            <Button variant="danger" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              Régénérer la clé
            </Button>
          </>
        }
      >
        <p>Toutes les adresses de flux actuelles cesseront de fonctionner. Il faudra mettre à jour vos abonnements dans votre lecteur.</p>
      </Dialog>
    </>
  );
}

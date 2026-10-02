import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Checkbox, PasswordField, Spinner, TextField } from '../components/ui/misc';
import { useDocumentTitle, useSite } from '../hooks/useSite';
import { t } from '../i18n/id';
import { ApiError, apiPost } from '../lib/api';
import { safeNext } from '../lib/url';
import { useSession, type User } from '../stores/session';
import { toast } from '../stores/toast';

export function LoginPage() {
  useDocumentTitle(t.login.title);
  const site = useSite();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const setUser = useSession((s) => s.setUser);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loaded && user && !busy) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Isi username dan password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ user: User }>('/auth/login', { username: username.trim(), password, remember });
      setUser(res.user);
      toast(`Selamat datang, ${res.user.displayName}`);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak dapat login. Coba lagi.');
      setBusy(false);
    }
  };

  return (
    <div className="dv-login">
      <form className="dv-login__card" onSubmit={submit} noValidate>
        <div className="dv-login__logo">
          <Logo />
        </div>
        <h1 className="dv-login__title">{t.login.title}</h1>
        <p className="dv-login__subtitle">{t.login.subtitle(site.name)}</p>
        <div className="dv-login__fields">
          <TextField
            label={t.login.username}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <PasswordField
            label={t.login.password}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            error={error}
          />
          <Checkbox checked={remember} onChange={setRemember}>
            {t.login.remember}
          </Checkbox>
        </div>
        <p className="dv-login__note">{t.login.noRegister}</p>
        <div className="dv-login__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner size={20} /> : t.login.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}

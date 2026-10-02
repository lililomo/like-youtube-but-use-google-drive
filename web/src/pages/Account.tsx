import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Avatar, PasswordField, TextField } from '../components/ui/misc';
import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { apiDelete, apiPatch, apiPost, apiPutFile, errorMessage } from '../lib/api';
import { useSession, type User } from '../stores/session';
import { toast } from '../stores/toast';

const PHOTO_MAX = 5 * 1024 * 1024;
const COLORS = ['#5c6bc0', '#26a69a', '#ef6c00', '#8e24aa', '#00897b', '#3949ab', '#d81b60', '#6d4c41', '#43a047', '#f4511e', '#c62828', '#546e7a'];

export function AccountPage() {
  useDocumentTitle(t.accountPage.title);
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);

  const [name, setName] = useState(user.displayName);
  const [color, setColor] = useState(user.avatarColor);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    setName(user.displayName);
    setColor(user.avatarColor);
  }, [user.displayName, user.avatarColor]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      const res = await apiPatch<{ user: User }>('/me', { displayName: name.trim(), avatarColor: color });
      setUser(res.user);
      toast(t.accountPage.profileSaved);
    } catch (err) {
      setProfileError(errorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > PHOTO_MAX) {
      toast(t.accountPage.photoTooBig);
      return;
    }
    setPhotoBusy(true);
    try {
      const res = await apiPutFile<{ user: User }>('/me/avatar', file);
      setUser(res.user);
      toast(t.accountPage.photoSaved);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      const res = await apiDelete<{ user: User }>('/me/avatar');
      setUser(res.user);
      toast(t.accountPage.photoRemoved);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setPwError(t.accountPage.mismatch);
      return;
    }
    setSavingPw(true);
    setPwError(null);
    try {
      await apiPost('/auth/password', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast(t.accountPage.passwordChanged);
    } catch (err) {
      setPwError(errorMessage(err));
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="dv-account-page">
      <h1 className="dv-page-title">{t.accountPage.title}</h1>

      <section className="dv-card">
        <h2 className="dv-card__title">{t.accountPage.photo}</h2>
        <div className="dv-account-page__photo">
          <Avatar name={name || user.username} color={color} src={user.avatarUrl} size={96} />
          <div className="dv-account-page__photo-actions">
            <p className="dv-text-secondary">{t.accountPage.photoHint}</p>
            <div className="dv-row">
              <Button variant="primary" disabled={photoBusy} onClick={() => fileInput.current?.click()}>
                {user.avatarUrl ? t.accountPage.photoChange : t.accountPage.photoUpload}
              </Button>
              {user.avatarUrl && (
                <Button disabled={photoBusy} onClick={removePhoto}>
                  {t.accountPage.photoRemove}
                </Button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              hidden
              onChange={uploadPhoto}
            />
          </div>
        </div>
      </section>

      <section className="dv-card">
        <h2 className="dv-card__title">{t.accountPage.profile}</h2>
        <form onSubmit={saveProfile} className="dv-form">
          <div className="dv-account-page__identity">
            <Avatar name={name || user.username} color={color} src={user.avatarUrl} size={64} />
            <div>
              <div className="dv-account-page__name">{name || user.username}</div>
              <div className="dv-text-secondary">@{user.username}</div>
            </div>
          </div>
          <TextField label={t.accountPage.displayName} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} error={profileError} />
          <div>
            <div className="dv-form__label">{t.accountPage.avatarColor}</div>
            <div className="dv-color-swatches" role="radiogroup" aria-label={t.accountPage.avatarColor}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  className={`dv-color-swatch${color === c ? ' is-selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="dv-form__actions">
            <Button type="submit" variant="primary" disabled={savingProfile || !name.trim()}>
              {t.accountPage.saveProfile}
            </Button>
          </div>
        </form>
      </section>

      <section className="dv-card">
        <h2 className="dv-card__title">{t.accountPage.password}</h2>
        <form onSubmit={savePassword} className="dv-form">
          <PasswordField label={t.accountPage.currentPassword} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <PasswordField label={t.accountPage.newPassword} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} helper="Minimal 8 karakter" />
          <PasswordField label={t.accountPage.confirmPassword} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={pwError} />
          <div className="dv-form__actions">
            <Button type="submit" variant="primary" disabled={savingPw || !current || next.length < 8}>
              {t.accountPage.changePassword}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

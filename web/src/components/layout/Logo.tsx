import { Link } from 'react-router';
import { useSite, type SiteInfo } from '../../hooks/useSite';

function Wordmark({ name }: { name: string }) {
  const [first, ...rest] = name.split(' ');
  return (
    <span className="dv-logo__word">
      <b>{first}</b>
      {/* spasi asli (bukan margin) agar teks terlihat = nama aksesibel (Lighthouse label-content-name-mismatch) */}
      {rest.length > 0 && <> <span>{rest.join(' ')}</span></>}
    </span>
  );
}

/** Gambar logo + varian tema gelap (ditukar lewat CSS html[data-theme="dark"]). */
function LogoImages({ site, className }: { site: SiteInfo; className: string }) {
  if (!site.logoUrl) return null;
  const dark = site.logoDarkUrl;
  return (
    <>
      <img className={`${className} dv-logo__img--light${dark ? ' has-dark' : ''}`} src={site.logoUrl} alt="" />
      {dark && <img className={`${className} dv-logo__img--dark`} src={dark} alt="" />}
    </>
  );
}

/** Isi logo (tanpa tautan) — dipakai juga untuk pratinjau di Studio. */
export function LogoContent({ site }: { site: SiteInfo }) {
  if (site.logoUrl && site.logoMode === 'full') {
    return (
      <>
        <LogoImages site={site} className="dv-logo__img" />
        <span className="dv-visually-hidden">{site.name}</span>
      </>
    );
  }
  return (
    <>
      {site.logoUrl ? (
        <LogoImages site={site} className="dv-logo__icon" />
      ) : (
        <svg className="dv-logo__mark" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#FF0000" />
          <path d="M9.5 7.2v9.6l7.6-4.8z" fill="#FFFFFF" />
        </svg>
      )}
      <Wordmark name={site.name} />
    </>
  );
}

/** Logo situs: nama & gambar diatur admin (Studio → Pengaturan → Situs); bawaan: ikon merah + nama. */
export function Logo({ onClick }: { onClick?: () => void }) {
  const site = useSite();
  return (
    <Link to="/" className="dv-logo" aria-label={`${site.name} - Beranda`} title={`${site.name} - Beranda`} onClick={onClick}>
      <LogoContent site={site} />
    </Link>
  );
}

import { Link } from 'react-router';
import { useSite } from '../../hooks/useSite';

/** Logo situs: gambar dari admin bila ada, kalau tidak logo bawaan (lingkaran merah + wordmark). */
export function Logo({ onClick }: { onClick?: () => void }) {
  const site = useSite();
  const [first, ...rest] = site.name.split(' ');
  return (
    <Link to="/" className="dv-logo" aria-label={`Beranda ${site.name}`} title={`Beranda ${site.name}`} onClick={onClick}>
      {site.logoUrl ? (
        <img className="dv-logo__img" src={site.logoUrl} alt={site.name} />
      ) : (
        <>
          <svg className="dv-logo__mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#FF0000" />
            <path d="M9.5 7.2v9.6l7.6-4.8z" fill="#FFFFFF" />
          </svg>
          <span className="dv-logo__word">
            <b>{first}</b>
            {rest.length > 0 && <span>{rest.join(' ')}</span>}
          </span>
        </>
      )}
    </Link>
  );
}

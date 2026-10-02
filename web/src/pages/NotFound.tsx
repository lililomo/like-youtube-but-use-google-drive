import { useDocumentTitle } from '../hooks/useSite';
import { t } from '../i18n/id';
import { ButtonLink } from '../components/ui/Button';
import { Icon } from '../components/icons/Icon';

export function NotFoundPage() {
  useDocumentTitle('404');
  return (
    <div className="dv-notfound">
      <div className="dv-notfound__art" aria-hidden="true">
        <Icon name="video-off" size={120} />
      </div>
      <h1 className="dv-notfound__title">{t.notFound.title}</h1>
      <p className="dv-notfound__subtitle">{t.notFound.subtitle}</p>
      <ButtonLink to="/" variant="tonal" icon="home">
        {t.notFound.home}
      </ButtonLink>
    </div>
  );
}

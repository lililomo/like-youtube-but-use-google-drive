import { useParams } from 'react-router';
import { NotFoundPage } from './NotFound';
import { PlaceholderPage } from './Placeholder';

/** Rute "/:handle" — hanya valid bila diawali "@" (contoh /@dymasvideo). */
export function ChannelPage() {
  const { handle = '' } = useParams();
  if (!handle.startsWith('@') || handle.length < 2) return <NotFoundPage />;
  return <PlaceholderPage title={handle} icon="account-circle" />;
}

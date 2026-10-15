import { useT } from '../utils/i18n';

// Shared at the entrypoint so authenticated views and public shares carry the
// same conspicuous notice, including when a card inspector covers the page.
export default function RiftboundNotice() {
  const { t } = useT();
  return (
    <footer className="riftbound-notice">
      <p>{t('riftbound.notice')}</p>
      <a href="https://www.riotgames.com/en/legal" target="_blank" rel="noreferrer">{t('riftbound.policy')}</a>
    </footer>
  );
}

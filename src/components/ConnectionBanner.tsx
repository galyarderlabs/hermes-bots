import { useConnection } from '../lib/connection-store';
import { GlassAlert } from './glassyui/GlassAlert';

export function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  const { status, error } = useConnection();
  if (status === 'online') return null;
  if (status === 'checking') {
    return <GlassAlert tone="info" message="Checking Hermes connection…" />;
  }
  return (
    <GlassAlert
      tone="error"
      message={error ?? 'Hermes unavailable — start Hermes Desktop, then retry.'}
      actionLabel="Retry"
      onAction={onRetry}
    />
  );
}

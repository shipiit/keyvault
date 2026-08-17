import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Onboarding } from './screens/Onboarding.jsx';
import { Unlock } from './screens/Unlock.jsx';
import { VaultList } from './screens/VaultList.jsx';
import { getStatus } from './lib/messaging.js';
import './styles.css';

/**
 * Popup root.
 *
 * Renders one of three states, decided by the background rather than by
 * anything held here: not yet set up, locked, or unlocked. The popup keeps no
 * durable state of its own — it is destroyed every time it closes.
 */
function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    getStatus()
      .then(setStatus)
      .catch((caught) => setError(caught.message));
  }, []);

  useEffect(refresh, [refresh]);

  if (error !== null) {
    return (
      <div role="alert" className="p-6 text-center text-sm text-[var(--color-danger)]">
        {error}
      </div>
    );
  }

  // Nothing at all until the status is known: flashing the unlock screen and
  // then replacing it with onboarding is worse than a brief blank.
  if (status === null) {
    return <div className="h-full" aria-busy="true" />;
  }

  if (!status.initialized) {
    return <Onboarding onCreated={refresh} />;
  }
  if (status.locked) {
    return <Unlock onUnlocked={refresh} />;
  }
  return <VaultList onLocked={refresh} />;
}

render(<App />, document.getElementById('root'));

'use client';

import { useEffect } from 'react';

export default function PwaUpdateHandler() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Skip on first install — controller is null until the SW activates for the first time.
    // We only want to reload on *updates*, not the initial install.
    if (!navigator.serviceWorker.controller) return;

    let isRefreshing = false;

    const handleControllerChange = () => {
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}

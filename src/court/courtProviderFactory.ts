/**
 * Court Provider Factory — Phase 7
 *
 * Central registry for all court filing provider implementations.
 * The adapter imports from here — no direct provider imports anywhere else.
 *
 * Active provider is controlled by COURT_PROVIDER environment variable:
 *
 *   COURT_PROVIDER=simulator      → SimulatorProvider (default, local dev + CI)
 *   COURT_PROVIDER=florida_tpv    → FloridaTPVProvider (post-certification)
 *
 * The factory performs lazy instantiation — FloridaTPVProvider is only
 * constructed when COURT_PROVIDER=florida_tpv, which prevents credential
 * loading errors in simulator environments.
 *
 * Adding a new provider:
 *   1. Implement CourtFilingProvider interface
 *   2. Add a case here
 *   3. Add to COURT_PROVIDER enum below
 *   4. Add to .env.example
 */

import type { CourtFilingProvider } from './courtFilingProvider';
import { simulatorProvider }        from './simulatorProvider';

// All valid COURT_PROVIDER values
export type CourtProviderName = 'simulator' | 'florida_tpv';

const VALID_PROVIDERS: CourtProviderName[] = ['simulator', 'florida_tpv'];

// Provider singleton cache — each provider is created once and reused
const providerCache = new Map<CourtProviderName, CourtFilingProvider>();

/**
 * getProvider
 *
 * Returns the active CourtFilingProvider instance based on COURT_PROVIDER env var.
 * Lazy-initializes providers on first access.
 */
export function getProvider(
  providerName?: CourtProviderName
): CourtFilingProvider {
  const name = (providerName ?? process.env.COURT_PROVIDER ?? 'simulator') as CourtProviderName;

  if (!VALID_PROVIDERS.includes(name)) {
    console.warn(
      `[CourtProviderFactory] Unknown COURT_PROVIDER="${name}". ` +
      `Valid options: ${VALID_PROVIDERS.join(', ')}. Falling back to simulator.`
    );
    return simulatorProvider;
  }

  // Return cached instance if already created
  if (providerCache.has(name)) {
    return providerCache.get(name)!;
  }

  let provider: CourtFilingProvider;

  switch (name) {
    case 'simulator':
      provider = simulatorProvider;
      console.log('[CourtProviderFactory] Active provider: SimulatorProvider');
      break;

    case 'florida_tpv': {
      // Lazy import — only loads when explicitly requested.
      // Prevents credential loading errors in non-TPV environments.
      const { FloridaTPVProvider } = require('./floridaTPVProvider');
      provider = new FloridaTPVProvider();
      console.log('[CourtProviderFactory] Active provider: FloridaTPVProvider');
      break;
    }
  }

  providerCache.set(name, provider!);
  return provider!;
}

/**
 * getActiveProviderName
 *
 * Returns the currently configured provider name.
 * Useful for health checks, admin panels, and audit logs.
 */
export function getActiveProviderName(): CourtProviderName {
  const name = process.env.COURT_PROVIDER ?? 'simulator';
  return VALID_PROVIDERS.includes(name as CourtProviderName)
    ? (name as CourtProviderName)
    : 'simulator';
}

/**
 * clearProviderCache
 *
 * Clears the singleton cache. Used in tests and when switching providers
 * at runtime (e.g., during live testing).
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

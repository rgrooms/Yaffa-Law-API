/**
 * Court Filing Adapter — Legal OS Entry Point (Phase 7 edition)
 *
 * This is the ONLY file the Legal OS imports to interact with court filing.
 * Provider selection is delegated to courtProviderFactory.ts.
 *
 * Legal OS → courtFilingAdapter → courtProviderFactory → SimulatorProvider (now)
 * Legal OS → courtFilingAdapter → courtProviderFactory → FloridaTPVProvider  (post-certification)
 *
 * To switch providers: set COURT_PROVIDER=florida_tpv in .env
 * No code changes required in any business logic.
 */

import { getProvider, getActiveProviderName } from './courtProviderFactory';
import type { CourtFilingProvider } from './courtFilingProvider';

// The adapter is the singleton provider for the current environment.
// Factory reads COURT_PROVIDER at startup.
export const courtFilingAdapter: CourtFilingProvider = getProvider();

// Expose active provider for health checks and admin routes
export { getActiveProviderName };

// Re-export all types — consumers import from here, never from the provider directly
export * from './courtFilingProvider';

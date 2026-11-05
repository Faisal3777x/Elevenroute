import type { Vendor } from '../../shared/types.ts';
import { state } from './store.ts';

/**
 * Per-vendor circuit breaker. After `breakerFailures` failures inside
 * `breakerWindowS`, the vendor's models go to the back of the queue for
 * `breakerCooldownS`. Time is passed in so synthetic traffic can replay
 * incidents on its own clock without touching the live breaker.
 */
export class Breaker {
  private failures = new Map<Vendor, number[]>();
  private openUntil = new Map<Vendor, number>();

  isOpen(vendor: Vendor, now = Date.now()): boolean {
    return (this.openUntil.get(vendor) ?? 0) > now;
  }

  recordFailure(vendor: Vendor, now = Date.now()): void {
    const { breakerFailures, breakerWindowS, breakerCooldownS } = state.strategy;
    const recent = (this.failures.get(vendor) ?? []).filter((t) => now - t < breakerWindowS * 1000);
    recent.push(now);
    this.failures.set(vendor, recent);
    if (recent.length >= breakerFailures) this.openUntil.set(vendor, now + breakerCooldownS * 1000);
  }

  recordSuccess(vendor: Vendor): void {
    this.failures.delete(vendor);
  }

  reset(): void {
    this.failures.clear();
    this.openUntil.clear();
  }
}

export const liveBreaker = new Breaker();

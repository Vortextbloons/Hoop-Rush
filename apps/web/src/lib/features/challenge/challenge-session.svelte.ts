import { ChallengeSession, type ChallengePhase } from '@hoop-rush/application/challenge';
import type { ChallengeRun } from '@hoop-rush/data-contracts';
import { getEraSimulationProfile, getManifest } from '#lib/data.js';
import { sleep } from '#lib/sleep.js';
import { prefersReducedMotion } from '#lib/device-capabilities.js';
import { challengeRepository } from './challenge-repo';
import { ChallengeWorkerJob } from './challenge-job';

export class ChallengeRunPresenter {
  run = $state.raw<ChallengeRun | null>(null);
  phase = $state<ChallengePhase>('idle');
  error = $state<string | null>(null);
  loadError = $state<string | null>(null);
  private session: ChallengeSession | null = null;
  private unsubscribe: (() => void) | null = null;
  init(): void {
    if (this.session !== null) return;
    const session = new ChallengeSession({
      repository: challengeRepository,
      job: new ChallengeWorkerJob(),
      assets: {
        loadEraSimulationProfile: async (eraId) => {
          const manifest = await getManifest();
          const entry = manifest.eraSimulationProfiles.find((profile) => profile.eraId === eraId);
          if (!entry) throw new Error('The decade simulation profile is unavailable.');
          return getEraSimulationProfile(entry);
        },
      },
      clock: {
        now: () => performance.now(),
        nowIso: () => new Date().toISOString(),
        sleep: (ms) => sleep(ms),
      },
    });
    this.session = session;
    this.unsubscribe = session.subscribe(() => {
      this.mirror();
    });
    this.mirror();
    void session.load();
  }
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
  }
  reload(): void {
    this.loadError = null;
    void this.session?.load();
  }
  start(): void {
    this.session?.start({ reducedMotion: prefersReducedMotion() });
    this.mirror();
  }
  resume(): void {
    this.start();
  }
  cancel(): void {
    this.session?.cancel();
    this.mirror();
  }
  private mirror(): void {
    const snapshot = this.session?.getSnapshot();
    if (snapshot === undefined) return;
    this.run = snapshot.run;
    this.phase = snapshot.phase;
    this.error = snapshot.error;
    this.loadError = snapshot.loadError;
  }
}

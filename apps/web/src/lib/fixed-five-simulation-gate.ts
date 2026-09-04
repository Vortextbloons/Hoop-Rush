export type FixedFiveSimulationReason = 'initial' | 'mismatch-rerun';
export class FixedFiveSimulationGate {
    private active = false;
    private completed = 0;
    canStart(reason: FixedFiveSimulationReason): boolean {
        if (this.active)
            return false;
        return reason === 'initial' ? this.completed === 0 : this.completed === 1;
    }
    tryStart(reason: FixedFiveSimulationReason): boolean {
        if (!this.canStart(reason))
            return false;
        this.active = true;
        return true;
    }
    finish(): void {
        if (!this.active)
            return;
        this.active = false;
        this.completed += 1;
    }
    fail(): void {
        this.active = false;
    }
    completedAttempts(): number {
        return this.completed;
    }
}

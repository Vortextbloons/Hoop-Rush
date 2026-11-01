export class GameExecution<TOutput extends { gameNumber: number }> {
  private outputs: Record<number, TOutput> = {};
  private jobs = new Set<number>();

  getOutputs(): Record<number, TOutput> {
    return this.outputs;
  }

  restore(outputs: readonly TOutput[]): void {
    const restored = { ...this.outputs };
    for (const output of outputs) restored[output.gameNumber] = output;
    this.outputs = restored;
  }

  reset(): void {
    this.outputs = {};
    this.jobs = new Set();
  }

  async run(input: {
    gameNumber: number;
    current(): boolean;
    simulate(): Promise<TOutput>;
    persist(output: TOutput): Promise<void>;
  }): Promise<'saved' | 'idle' | 'abandoned'> {
    if (!input.current()) return 'abandoned';
    if (this.outputs[input.gameNumber] || this.jobs.has(input.gameNumber)) return 'idle';
    const jobs = this.jobs;
    jobs.add(input.gameNumber);
    try {
      const output = await input.simulate();
      if (!input.current()) return 'abandoned';
      if (output.gameNumber !== input.gameNumber)
        throw new Error('simulation returned the wrong game number');
      await input.persist(output);
      if (!input.current()) return 'abandoned';
      this.outputs = { ...this.outputs, [output.gameNumber]: output };
      return 'saved';
    } finally {
      jobs.delete(input.gameNumber);
    }
  }
}

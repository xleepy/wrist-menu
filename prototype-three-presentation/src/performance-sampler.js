export class PerformanceSampler {
  constructor(capacity = 600) {
    this.samples = new Float64Array(capacity);
    this.capacity = capacity;
    this.count = 0;
    this.cursor = 0;
  }

  record(duration) {
    this.samples[this.cursor] = duration;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  snapshot() {
    if (this.count === 0) return { p50: 0, p95: 0, p99: 0, samples: 0 };
    const values = Array.from(this.samples.slice(0, this.count)).sort((a, b) => a - b);
    const percentile = (value) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * value))];
    return {
      p50: percentile(.5),
      p95: percentile(.95),
      p99: percentile(.99),
      samples: values.length,
    };
  }
}

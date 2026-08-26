export function sigmoid(logit: number): number {
    if (logit > 36)
        return 1;
    if (logit < -36)
        return 0;
    return 1 / (1 + Math.exp(-logit));
}
export function normalQuantile(p: number): number {
    const a = [
        -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
        -3.066479806614716e1, 2.506628277459239,
    ];
    const b = [
        -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
        -1.328068155288572e1,
    ];
    const c = [
        -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
        4.374664141464968, 2.938163982698783,
    ];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const low = 0.02425;
    const high = 1 - low;
    const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    const num = (coefs: readonly number[], r: number): number => coefs.reduce((sum, coef) => sum * r + coef, 0);
    const den = (coefs: readonly number[], r: number): number => coefs.reduce((sum, coef) => sum * r + coef, 0) * r + 1;
    if (q < low) {
        const r = Math.sqrt(-2 * Math.log(q));
        return num(c, r) / den(d, r);
    }
    if (q > high) {
        const r = Math.sqrt(-2 * Math.log(1 - q));
        return -num(c, r) / den(d, r);
    }
    const r = q - 0.5;
    const inner = r * r;
    return (num(a, inner) * r) / den(b, inner);
}
export { fnv1a32 } from '@hoop-rush/data-contracts';
export function withIntercept(rows: readonly (readonly number[])[]): number[][] {
    return rows.map((row) => [1, ...row]);
}
export function matMul(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] {
    const m = a.length;
    const n = b[0]?.length ?? 0;
    const inner = b.length;
    const out: number[][] = [];
    for (let i = 0; i < m; i += 1) {
        const row: number[] = [];
        for (let j = 0; j < n; j += 1) {
            let sum = 0;
            for (let k = 0; k < inner; k += 1) {
                sum += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
            }
            row.push(sum);
        }
        out.push(row);
    }
    return out;
}
export function transpose(a: readonly (readonly number[])[]): number[][] {
    const rows = a.length;
    const cols = a[0]?.length ?? 0;
    const out: number[][] = [];
    for (let j = 0; j < cols; j += 1) {
        const col: number[] = [];
        for (let i = 0; i < rows; i += 1) {
            col.push(a[i]?.[j] ?? 0);
        }
        out.push(col);
    }
    return out;
}
export function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] {
    const n = b.length;
    const m = a.map((row) => [...row]);
    const rhs = [...b];
    for (let col = 0; col < n; col += 1) {
        let pivot = col;
        for (let row = col + 1; row < n; row += 1) {
            if (Math.abs(m[row]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0))
                pivot = row;
        }
        if (Math.abs(m[pivot]?.[col] ?? 0) < 1e-14) {
            throw new Error('singular system in reconstruction fit');
        }
        if (pivot !== col) {
            [m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]];
            [rhs[col], rhs[pivot]] = [rhs[pivot] as number, rhs[col] as number];
        }
        const pivotValue = m[col]?.[col] ?? 0;
        for (let row = col + 1; row < n; row += 1) {
            const factor = (m[row]?.[col] ?? 0) / pivotValue;
            if (factor === 0)
                continue;
            const sourceRow = m[row] as number[];
            const pivotRow = m[col] as number[];
            for (let j = col; j < n; j += 1) {
                sourceRow[j] = (sourceRow[j] ?? 0) - factor * (pivotRow[j] ?? 0);
            }
            rhs[row] = (rhs[row] ?? 0) - factor * (rhs[col] ?? 0);
        }
    }
    const x: number[] = new Array<number>(n).fill(0);
    for (let row = n - 1; row >= 0; row -= 1) {
        let sum = rhs[row] ?? 0;
        for (let j = row + 1; j < n; j += 1) {
            sum -= (m[row]?.[j] ?? 0) * (x[j] ?? 0);
        }
        x[row] = sum / (m[row]?.[row] ?? 1);
    }
    return x;
}
export function invert(a: readonly (readonly number[])[]): number[][] {
    const n = a.length;
    const identity: number[][] = [];
    for (let i = 0; i < n; i += 1) {
        identity.push(new Array<number>(n).fill(0).map((_, j) => (i === j ? 1 : 0)));
    }
    const cols: number[][] = [];
    for (let j = 0; j < n; j += 1) {
        cols.push(solveLinear(a, identity[j] as number[]));
    }
    return transpose(cols);
}
export interface FittedBinomial {
    coefficients: number[];
    covariance: number[][];
    iterations: number;
}
export function fitBinomialLogistic(design: readonly (readonly number[])[], makes: readonly number[], trials: readonly number[], lambda: number, priorMakes: number, priorTrials: number, maxIterations = 40, tolerance = 1e-9, penalties?: readonly number[]): FittedBinomial {
    const k = design[0]?.length ?? 0;
    if (k === 0)
        throw new Error('empty design matrix');
    let beta: number[] = new Array<number>(k).fill(0);
    const xRows = design.map((row) => [...row]);
    const y: number[] = makes.map((m, i) => m / Math.max(1, trials[i] ?? 1));
    const w: number[] = makes.map((_, i) => Math.max(0, trials[i] ?? 0));
    xRows.push(new Array<number>(k).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    y.push(priorMakes / Math.max(1, priorTrials));
    w.push(Math.max(0, priorTrials));
    const penalty = new Array<number>(k)
        .fill(0)
        .map((_, i) => (i === 0 ? 0 : (penalties?.[i] ?? lambda)));
    let iterations = 0;
    for (; iterations < maxIterations; iterations += 1) {
        const p: number[] = [];
        for (let i = 0; i < xRows.length; i += 1) {
            const row = xRows[i] as number[];
            let logit = 0;
            for (let j = 0; j < k; j += 1)
                logit += (row[j] ?? 0) * (beta[j] ?? 0);
            p.push(sigmoid(logit));
        }
        const h: number[][] = new Array<number>(k).fill(0).map(() => new Array<number>(k).fill(0));
        const gradient: number[] = new Array<number>(k).fill(0);
        for (let i = 0; i < xRows.length; i += 1) {
            const row = xRows[i] as number[];
            const weight = (w[i] ?? 0) * Math.max(1e-12, (p[i] ?? 0) * (1 - (p[i] ?? 0)));
            const residual = (y[i] ?? 0) - (p[i] ?? 0);
            for (let j = 0; j < k; j += 1) {
                gradient[j] = (gradient[j] ?? 0) + (row[j] ?? 0) * (w[i] ?? 0) * residual;
            }
            for (let a = 0; a < k; a += 1) {
                for (let b = a; b < k; b += 1) {
                    (h[a] as number[])[b] = (h[a]?.[b] ?? 0) + (row[a] ?? 0) * (row[b] ?? 0) * weight;
                }
            }
        }
        for (let j = 0; j < k; j += 1) {
            (h[j] as number[])[j] = (h[j]?.[j] ?? 0) + (penalty[j] ?? 0);
        }
        const step = solveLinear(h, gradient);
        const next = beta.map((value, i) => value + (step[i] ?? 0));
        let maxDelta = 0;
        for (let j = 0; j < k; j += 1) {
            maxDelta = Math.max(maxDelta, Math.abs((next[j] ?? 0) - (beta[j] ?? 0)));
        }
        beta = next;
        if (maxDelta < tolerance)
            break;
    }
    const h: number[][] = new Array<number>(k).fill(0).map(() => new Array<number>(k).fill(0));
    for (let i = 0; i < xRows.length; i += 1) {
        const row = xRows[i] as number[];
        const eta = row.reduce((sum, value, j) => sum + value * (beta[j] ?? 0), 0);
        const prob = sigmoid(eta);
        const weight = (w[i] ?? 0) * Math.max(1e-12, prob * (1 - prob));
        for (let a = 0; a < k; a += 1) {
            for (let b = a; b < k; b += 1) {
                (h[a] as number[])[b] = (h[a]?.[b] ?? 0) + (row[a] ?? 0) * (row[b] ?? 0) * weight;
            }
        }
    }
    for (let j = 0; j < k; j += 1) {
        (h[j] as number[])[j] = (h[j]?.[j] ?? 0) + (penalty[j] ?? 0);
    }
    return { coefficients: beta, covariance: invert(h), iterations };
}

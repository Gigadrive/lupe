/**
 * Evaluation metrics for the lupe operating point. Used to prove the grounding
 * verifier raises net precision without gutting recall, and to hold the noise
 * budget (≈5 actionable comments/PR).
 */

export interface ConfusionCounts {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

export interface PrecisionRecall extends ConfusionCounts {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** Compare predicted finding keys against a labelled ground-truth set. */
export function precisionRecall(predicted: Iterable<string>, groundTruth: Iterable<string>): PrecisionRecall {
  const predictedSet = new Set(predicted);
  const truthSet = new Set(groundTruth);

  let truePositives = 0;
  for (const key of predictedSet) if (truthSet.has(key)) truePositives++;
  const falsePositives = predictedSet.size - truePositives;
  const falseNegatives = truthSet.size - truePositives;

  const precision = predictedSet.size === 0 ? 1 : truePositives / predictedSet.size;
  const recall = truthSet.size === 0 ? 1 : truePositives / truthSet.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 };
}

export interface NoiseBudget {
  readonly mean: number;
  readonly p90: number;
  readonly max: number;
}

/** Summarise actionable-comments-per-PR across a labelled set. */
export function noiseBudget(actionablePerPr: readonly number[]): NoiseBudget {
  if (actionablePerPr.length === 0) return { mean: 0, p90: 0, max: 0 };
  const sorted = [...actionablePerPr].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p90Index = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1);
  return { mean, p90: sorted[p90Index]!, max: sorted[sorted.length - 1]! };
}

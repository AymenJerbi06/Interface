import {
  knnModelArtifact,
  projectModelMetadata,
  reviewDemandArtifact,
  type KNNTrainingRow,
} from "./model-data/projectModelRows";

export type ProjectModelInput = {
  city: string;
  category: string;
  priceLevel: number;
  latitude: number;
  longitude: number;
  medianIncome: number;
  popDensity: number;
  ageShare: number;
  competitorCount: number;
  transitDistance: number;
};

export type ProjectModelResult = {
  rating: number;
  ratingPercent: number;
  successClassification: "Successful" | "Not successful";
};

export { projectModelMetadata };
export const projectCategoryLabels = reviewDemandArtifact.categoryLabels;

const KNN_NEIGHBORS = 35;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function standardize(value: number, featureName: string) {
  const stats = knnModelArtifact.featureStats[featureName];
  return (value - stats.mean) / stats.std;
}

function transformInput(input: ProjectModelInput) {
  const medianIncome = safePositive(input.medianIncome, knnModelArtifact.imputeValues.median_income);
  const popDensity = safePositive(input.popDensity, knnModelArtifact.imputeValues.pop_density_sqkm);
  const competitorCount = safePositive(input.competitorCount, knnModelArtifact.imputeValues.competitor_count_500m);
  const transitDistance = safePositive(input.transitDistance, knnModelArtifact.imputeValues.nearest_transit_distance_m);

  const engineered = {
    log_median_income: Math.log1p(medianIncome),
    log_pop_density_sqkm: Math.log1p(popDensity),
    log_competitor_count_500m: Math.log1p(competitorCount),
    log_nearest_transit_distance_m: Math.log1p(transitDistance),
    income_density_ratio: medianIncome / (popDensity + 1),
    competition_transit_ratio: competitorCount / (transitDistance + 1),
  };

  const firstPass = [
    ...knnModelArtifact.cityLabels.map((city) => (city === input.city ? 1 : 0)),
    ...knnModelArtifact.engineeredFeatureNames.map((name) => standardize(engineered[name], name)),
  ];

  return firstPass.map((value, index) => {
    const mean = knnModelArtifact.scalerMeans[index] ?? 0;
    const std = knnModelArtifact.scalerStds[index] || 1;
    return (value - mean) / std;
  });
}

function distanceSquared(left: readonly number[], right: readonly number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] - right[index]) ** 2;
  }
  return total;
}

function nearestKnnRows(vector: number[]) {
  return knnModelArtifact.rows
    .map((row) => ({
      row,
      distance: Math.sqrt(distanceSquared(vector, row[0])),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, KNN_NEIGHBORS);
}

function weightedAverage<T>(
  items: T[],
  weightFor: (item: T) => number,
  valueFor: (item: T) => number,
) {
  let weightedTotal = 0;
  let weightTotal = 0;

  for (const item of items) {
    const weight = weightFor(item);
    weightedTotal += valueFor(item) * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? weightedTotal / weightTotal : 0;
}

export function predictLocation(input: ProjectModelInput): ProjectModelResult {
  const vector = transformInput(input);
  const nearest = nearestKnnRows(vector);
  const weightFor = (item: { row: KNNTrainingRow; distance: number }) => 1 / (item.distance + 0.24) ** 2;

  const rating = clamp(
    weightedAverage(nearest, weightFor, (item) => item.row[1]),
    0,
    5,
  );
  const weightedSuccess = weightedAverage(nearest, weightFor, (item) => item.row[2]);

  return {
    rating: Number(rating.toFixed(2)),
    ratingPercent: Math.round((rating / 5) * 100),
    successClassification: clamp(weightedSuccess, 0, 1) >= 0.5 ? "Successful" : "Not successful",
  };
}

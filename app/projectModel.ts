import {
  knnModelArtifact,
  projectModelMetadata,
  reviewDemandArtifact,
  type KNNTrainingRow,
  type ReviewDemandRow,
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
  age: number;
  competition: number;
  density: number;
  featureReadiness: number;
  income: number;
  knnProbability: number;
  rating: number;
  ratingPercent: number;
  reviewDemand: number;
  successProbability: number;
  transit: number;
  verdict: "Promising" | "Worth testing" | "Needs caution";
  xgbProbability: number;
};

export { projectModelMetadata };

const KNN_NEIGHBORS = 35;
const REVIEW_NEIGHBORS = 32;

const categoryFamilies: string[][] = [
  ["Cafes", "Coffee & Tea", "Coffee Roasteries", "Themed Cafes"],
  ["Japanese", "Sushi Bars", "Ramen"],
  ["Chinese", "Dim Sum", "Cantonese", "Hong Kong Style Cafe", "Taiwanese"],
  ["Canadian (New)", "Comfort Food", "Bistros", "Pubs", "Gastropubs"],
  ["Vietnamese", "Thai", "Malaysian", "Singaporean", "Filipino"],
  ["Indian", "Pakistani", "Himalayan/Nepalese"],
  ["Desserts", "Bakeries", "Patisserie/Cake Shop", "Waffles"],
  ["Pizza", "Italian"],
  ["Korean", "Barbeque"],
  ["Seafood", "Fish & Chips"],
  ["Breakfast & Brunch", "Diners"],
  ["Burgers", "Fast Food", "Hot Dogs", "Donairs"],
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: number, min: number, max: number) {
  return clamp((value - min) / (max - min), 0, 1);
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

function categoryDistance(inputCategory: string, rowCategory: string) {
  if (inputCategory === rowCategory) {
    return 0;
  }

  const inputFamily = categoryFamilies.find((family) => family.includes(inputCategory));
  if (inputFamily?.includes(rowCategory)) {
    return 0.35;
  }

  return 1;
}

function reviewDistance(input: ProjectModelInput, row: ReviewDemandRow) {
  const [city, category, priceLevel, latitude, longitude] = row;
  const latDistance = (input.latitude - latitude) / 0.035;
  const lngDistance = (input.longitude - longitude) / 0.045;
  const priceDistance = Math.abs(input.priceLevel - priceLevel) * 0.35;
  const cityDistance = city === input.city ? 0 : 0.9;
  const categoryPenalty = categoryDistance(input.category, category) * 0.75;

  return Math.sqrt(
    latDistance ** 2 +
      lngDistance ** 2 +
      priceDistance ** 2 +
      cityDistance ** 2 +
      categoryPenalty ** 2,
  );
}

function predictReviewDemand(input: ProjectModelInput) {
  const nearest = reviewDemandArtifact.rows
    .map((row) => ({ row, distance: reviewDistance(input, row) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, REVIEW_NEIGHBORS);

  const logReviewCount = weightedAverage(
    nearest,
    (item) => 1 / (item.distance + 0.22) ** 2,
    (item) => item.row[5],
  );

  return Math.round(clamp(Math.expm1(logReviewCount), 5, 2800));
}

function rangeReadiness(value: number, min: number, max: number) {
  if (value >= min && value <= max) {
    return 1;
  }

  const span = Math.max(max - min, 1);
  const distance = value < min ? min - value : value - max;
  return clamp(1 - distance / span, 0, 1);
}

function calculateFeatureReadiness(input: ProjectModelInput) {
  const ranges = knnModelArtifact.numericRanges;
  const categoryKnown = reviewDemandArtifact.categoryLabels.includes(input.category) ? 1 : 0.72;
  const cityKnown = knnModelArtifact.cityLabels.includes(input.city) ? 1 : 0.65;
  const priceKnown = input.priceLevel >= 1 && input.priceLevel <= 4 ? 1 : 0.4;

  const numericScores = [
    rangeReadiness(input.medianIncome, ...ranges.median_income),
    rangeReadiness(input.popDensity, ...ranges.pop_density_sqkm),
    rangeReadiness(input.competitorCount, ...ranges.competitor_count_500m),
    rangeReadiness(input.transitDistance, ...ranges.nearest_transit_distance_m),
  ];

  const average =
    [...numericScores, categoryKnown, cityKnown, priceKnown].reduce((total, value) => total + value, 0) /
    (numericScores.length + 3);

  return Math.round(average * 100);
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
  const successProbability = Math.round(clamp(weightedSuccess * 100, 1, 99));
  const reviewDemand = predictReviewDemand(input);
  const featureReadiness = calculateFeatureReadiness(input);

  const verdict =
    successProbability >= 72
      ? "Promising"
      : successProbability >= 55
        ? "Worth testing"
        : "Needs caution";

  return {
    age: normalize(input.ageShare, 10, 55),
    competition: normalize(input.competitorCount, 0, 71),
    density: normalize(input.popDensity, 0, 26785.84),
    featureReadiness,
    income: normalize(input.medianIncome, 0, 57748.28),
    knnProbability: successProbability,
    rating: Number(rating.toFixed(2)),
    ratingPercent: Math.round((rating / 5) * 100),
    reviewDemand,
    successProbability,
    transit: 1 - normalize(input.transitDistance, 1.27, 1563.44),
    verdict,
    xgbProbability: successProbability,
  };
}

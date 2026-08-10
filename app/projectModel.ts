import {
  boostedSuccessArtifact,
  decisionTreeRatingArtifact,
  knnModelArtifact,
  projectModelMetadata,
  ridgeRatingArtifact,
  reviewDemandArtifact,
  type KNNTrainingRow,
  type TreeNode,
} from "./model-data/projectModelRows";

export type RatingModelId = "linearRegression" | "decisionTree";
export type SuccessModelId = "knn" | "xgBoost";

export type ProjectModelOptions = {
  ratingModel: RatingModelId;
  successModel: SuccessModelId;
};

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
  ratingModelLabel: string;
  successModelLabel: string;
};

export { projectModelMetadata };
export const projectCategoryLabels = reviewDemandArtifact.categoryLabels;
export const defaultModelOptions: ProjectModelOptions = {
  ratingModel: "linearRegression",
  successModel: "knn",
};
export const ratingModelOptions: Array<{ id: RatingModelId; label: string }> = [
  { id: "linearRegression", label: "Linear/Ridge regression" },
  { id: "decisionTree", label: "Decision tree regression" },
];
export const successModelOptions: Array<{ id: SuccessModelId; label: string }> = [
  { id: "knn", label: "KNN classifier" },
  { id: "xgBoost", label: "XGBoost classifier" },
];

const KNN_NEIGHBORS = 35;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function standardizeClassifierFeature(value: number, featureName: string) {
  const stats = knnModelArtifact.featureStats[featureName];
  return (value - stats.mean) / stats.std;
}

function classifierFeatureValues(input: ProjectModelInput): Record<string, number> {
  const medianIncome = safePositive(input.medianIncome, knnModelArtifact.imputeValues.median_income);
  const popDensity = safePositive(input.popDensity, knnModelArtifact.imputeValues.pop_density_sqkm);
  const competitorCount = safePositive(input.competitorCount, knnModelArtifact.imputeValues.competitor_count_500m);
  const transitDistance = safePositive(input.transitDistance, knnModelArtifact.imputeValues.nearest_transit_distance_m);
  const ageShare = safePositive(input.ageShare, knnModelArtifact.imputeValues.pct_age_20_39);

  return {
    median_income: medianIncome,
    pop_density_sqkm: popDensity,
    competitor_count_500m: competitorCount,
    nearest_transit_distance_m: transitDistance,
    pct_age_20_39: ageShare,
    log_median_income: Math.log1p(medianIncome),
    log_pop_density_sqkm: Math.log1p(popDensity),
    log_competitor_count_500m: Math.log1p(competitorCount),
    log_nearest_transit_distance_m: Math.log1p(transitDistance),
    income_density_ratio: medianIncome / (popDensity + 1),
    competition_transit_ratio: competitorCount / (transitDistance + 1),
  };
}

function transformClassifierInput(input: ProjectModelInput) {
  const values = classifierFeatureValues(input);
  const firstPass = knnModelArtifact.modelFeatureNames.map((name) =>
    standardizeClassifierFeature(values[name], name),
  );

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

function predictTree(nodes: readonly TreeNode[], vector: readonly number[]) {
  let nodeIndex = 0;

  while (true) {
    const node = nodes[nodeIndex];
    if (node.featureIndex === undefined || node.left === undefined || node.right === undefined) {
      return node.value;
    }
    nodeIndex = vector[node.featureIndex] <= (node.threshold ?? 0) ? node.left : node.right;
  }
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function ratingNumericValue(input: ProjectModelInput, featureName: string) {
  if (featureName === "median_income") {
    return safePositive(input.medianIncome, ridgeRatingArtifact.numericStats["median_income"].mean);
  }

  if (featureName === "latitude") {
    return input.latitude;
  }

  if (featureName === "longitude") {
    return input.longitude;
  }

  return 0;
}

function ratingCategoricalValue(input: ProjectModelInput, featureName: string) {
  if (featureName === "city") {
    return input.city;
  }

  if (featureName === "primary_category") {
    return input.category;
  }

  if (featureName === "price_level") {
    return String(input.priceLevel);
  }

  return "";
}

function predictLinearRegressionRating(input: ProjectModelInput) {
  const numericValues = ridgeRatingArtifact.numericFeatures.map((featureName) => {
    const stats = ridgeRatingArtifact.numericStats[featureName];
    return (ratingNumericValue(input, featureName) - stats.mean) / stats.std;
  });

  const categoricalValues = ridgeRatingArtifact.categoricalFeatures.flatMap((featureName) => {
    const currentValue = ratingCategoricalValue(input, featureName);
    return ridgeRatingArtifact.categoryValues[featureName].map((value) => (currentValue === value ? 1 : 0));
  });

  const features = [...numericValues, ...categoricalValues];
  return features.reduce(
    (total, value, index) => total + value * ridgeRatingArtifact.coefficients[index],
    ridgeRatingArtifact.intercept,
  );
}

function decisionTreeNumericValue(input: ProjectModelInput, featureName: string) {
  if (featureName === "latitude") {
    return Number.isFinite(input.latitude) ? input.latitude : decisionTreeRatingArtifact.numericImputeValues[featureName];
  }

  if (featureName === "longitude") {
    return Number.isFinite(input.longitude)
      ? input.longitude
      : decisionTreeRatingArtifact.numericImputeValues[featureName];
  }

  return decisionTreeRatingArtifact.numericImputeValues[featureName] ?? 0;
}

function decisionTreeCategoricalValue(input: ProjectModelInput, featureName: string) {
  if (featureName === "city") {
    return input.city || decisionTreeRatingArtifact.categoricalImputeValues[featureName];
  }

  if (featureName === "primary_category") {
    return input.category || decisionTreeRatingArtifact.categoricalImputeValues[featureName];
  }

  return decisionTreeRatingArtifact.categoricalImputeValues[featureName] ?? "";
}

function predictDecisionTreeRating(input: ProjectModelInput) {
  const numericValues = decisionTreeRatingArtifact.numericFeatures.map((featureName) =>
    decisionTreeNumericValue(input, featureName),
  );
  const categoricalValues = decisionTreeRatingArtifact.categoricalFeatures.flatMap((featureName) => {
    const currentValue = decisionTreeCategoricalValue(input, featureName);
    return decisionTreeRatingArtifact.categoryValues[featureName].map((value) => (currentValue === value ? 1 : 0));
  });

  return predictTree(decisionTreeRatingArtifact.nodes, [...numericValues, ...categoricalValues]);
}

function predictRating(input: ProjectModelInput, ratingModel: RatingModelId) {
  if (ratingModel === "decisionTree") {
    return predictDecisionTreeRating(input);
  }

  return predictLinearRegressionRating(input);
}

function predictKnnSuccess(input: ProjectModelInput) {
  const vector = transformClassifierInput(input);
  const nearest = nearestKnnRows(vector);
  const weightFor = (item: { row: KNNTrainingRow; distance: number }) => 1 / (item.distance + 0.24) ** 2;

  return weightedAverage(nearest, weightFor, (item) => item.row[1]);
}

function predictBoostedSuccess(input: ProjectModelInput) {
  const vector = transformClassifierInput(input);
  const logit = boostedSuccessArtifact.trees.reduce(
    (total, nodes) => total + boostedSuccessArtifact.learningRate * predictTree(nodes, vector),
    boostedSuccessArtifact.baseLogit,
  );

  return sigmoid(logit);
}

function predictSuccess(input: ProjectModelInput, successModel: SuccessModelId) {
  if (successModel === "xgBoost") {
    return predictBoostedSuccess(input);
  }

  return predictKnnSuccess(input);
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

export function predictLocation(
  input: ProjectModelInput,
  options: ProjectModelOptions = defaultModelOptions,
): ProjectModelResult {
  const rating = clamp(predictRating(input, options.ratingModel), 0, 5);
  const weightedSuccess = predictSuccess(input, options.successModel);
  const ratingOption = ratingModelOptions.find((model) => model.id === options.ratingModel) ?? ratingModelOptions[0];
  const successOption = successModelOptions.find((model) => model.id === options.successModel) ?? successModelOptions[0];

  return {
    rating: Number(rating.toFixed(2)),
    ratingPercent: Math.round((rating / 5) * 100),
    successClassification: clamp(weightedSuccess, 0, 1) >= 0.5 ? "Successful" : "Not successful",
    ratingModelLabel: ratingOption.label,
    successModelLabel: successOption.label,
  };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.argv[2];

if (!repoRoot) {
  console.error("Usage: node scripts/import-project-model-data.mjs <CMPT310_Project repo path>");
  process.exit(1);
}

const yelpSourceFile = "yelp-and-demo-info.csv";
const locationSourceCandidates = ["location-information-with-competitors.csv", "location-information.csv"];
const yelpPath = path.join(repoRoot, yelpSourceFile);
const outPath = path.resolve("app/model-data/projectModelRows.ts");

async function readFirstExisting(root, sourceFiles) {
  const missing = [];

  for (const sourceFile of sourceFiles) {
    try {
      return {
        sourceFile,
        text: await readFile(path.join(root, sourceFile), "utf8"),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      missing.push(sourceFile);
    }
  }

  throw new Error(`Could not find any location source CSV. Tried: ${missing.join(", ")}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])),
  );
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function std(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  const average = mean(valid);
  const variance = valid.reduce((total, value) => total + (value - average) ** 2, 0) / valid.length;
  return Math.sqrt(variance) || 1;
}

function quantize(value, digits = 5) {
  return Number(value.toFixed(digits));
}

function median(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  const middle = Math.floor(valid.length / 2);

  if (valid.length === 0) {
    return 0;
  }

  return valid.length % 2 === 0 ? (valid[middle - 1] + valid[middle]) / 2 : valid[middle];
}

function mode(values, fallback = "") {
  const counts = new Map();

  for (const value of values) {
    const key = String(value ?? "").trim();
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let bestValue = fallback;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < bestValue)) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
}

function imputeRows(rows, numericColumns) {
  const imputeValues = Object.fromEntries(
    numericColumns.map((column) => [column, mean(rows.map((row) => numberValue(row[column])))]),
  );

  return rows.map((row) => {
    const next = { ...row };
    for (const column of numericColumns) {
      next[column] = numberValue(next[column]) ?? imputeValues[column];
    }
    return next;
  });
}

function squaredError(sumValue, sumSquared, count) {
  return count > 0 ? sumSquared - (sumValue * sumValue) / count : 0;
}

function trainRegressionTree(featureRows, targets, options) {
  const maxDepth = options.maxDepth;
  const minSamplesLeaf = options.minSamplesLeaf;
  const minGain = options.minGain ?? 1e-9;
  const featureCount = featureRows[0]?.length ?? 0;
  const nodes = [];

  function build(indices, depth) {
    const total = indices.reduce((sumValue, rowIndex) => sumValue + targets[rowIndex], 0);
    const totalSquared = indices.reduce((sumValue, rowIndex) => sumValue + targets[rowIndex] ** 2, 0);
    const value = total / indices.length;
    const nodeIndex = nodes.length;
    nodes.push({ value: quantize(value, 8) });

    if (depth >= maxDepth || indices.length < minSamplesLeaf * 2 || featureCount === 0) {
      return nodeIndex;
    }

    const parentError = squaredError(total, totalSquared, indices.length);
    let bestSplit = null;

    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      const ordered = indices
        .map((rowIndex) => ({
          rowIndex,
          value: Number.isFinite(featureRows[rowIndex][featureIndex]) ? featureRows[rowIndex][featureIndex] : 0,
          target: targets[rowIndex],
        }))
        .sort((left, right) => left.value - right.value);

      let leftCount = 0;
      let leftSum = 0;
      let leftSquared = 0;
      let rightCount = ordered.length;
      let rightSum = total;
      let rightSquared = totalSquared;

      for (let position = 0; position < ordered.length - 1; position += 1) {
        const current = ordered[position];
        leftCount += 1;
        leftSum += current.target;
        leftSquared += current.target ** 2;
        rightCount -= 1;
        rightSum -= current.target;
        rightSquared -= current.target ** 2;

        const next = ordered[position + 1];
        if (current.value === next.value || leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) {
          continue;
        }

        const error = squaredError(leftSum, leftSquared, leftCount) + squaredError(rightSum, rightSquared, rightCount);
        const gain = parentError - error;
        if (!bestSplit || gain > bestSplit.gain) {
          bestSplit = {
            featureIndex,
            threshold: (current.value + next.value) / 2,
            gain,
          };
        }
      }
    }

    if (!bestSplit || bestSplit.gain <= minGain) {
      return nodeIndex;
    }

    const leftIndices = [];
    const rightIndices = [];
    for (const rowIndex of indices) {
      const value = Number.isFinite(featureRows[rowIndex][bestSplit.featureIndex])
        ? featureRows[rowIndex][bestSplit.featureIndex]
        : 0;
      if (value <= bestSplit.threshold) {
        leftIndices.push(rowIndex);
      } else {
        rightIndices.push(rowIndex);
      }
    }

    if (leftIndices.length < minSamplesLeaf || rightIndices.length < minSamplesLeaf) {
      return nodeIndex;
    }

    const left = build(leftIndices, depth + 1);
    const right = build(rightIndices, depth + 1);
    nodes[nodeIndex] = {
      ...nodes[nodeIndex],
      featureIndex: bestSplit.featureIndex,
      threshold: quantize(bestSplit.threshold, 8),
      left,
      right,
    };
    return nodeIndex;
  }

  build(
    Array.from({ length: featureRows.length }, (_, index) => index),
    0,
  );
  return nodes;
}

function predictRegressionTree(nodes, row) {
  let nodeIndex = 0;

  while (true) {
    const node = nodes[nodeIndex];
    if (node.featureIndex === undefined || node.left === undefined || node.right === undefined) {
      return node.value;
    }
    nodeIndex = row[node.featureIndex] <= node.threshold ? node.left : node.right;
  }
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function buildKnnArtifact(rows) {
  const numericColumns = [
    "median_income",
    "pop_density_sqkm",
    "competitor_count_500m",
    "nearest_transit_distance_m",
    "pct_age_20_39",
  ];
  const imputed = imputeRows(rows, numericColumns).filter((row) => {
    return numberValue(row.target_is_successful) !== null;
  });

  const engineeredFeatureNames = [
    "log_median_income",
    "log_pop_density_sqkm",
    "log_competitor_count_500m",
    "log_nearest_transit_distance_m",
    "income_density_ratio",
    "competition_transit_ratio",
  ];
  const modelFeatureNames = [...numericColumns, ...engineeredFeatureNames];

  const engineeredRows = imputed.map((row) => {
    const medianIncome = row.median_income;
    const popDensity = row.pop_density_sqkm;
    const competitorCount = row.competitor_count_500m;
    const transitDistance = row.nearest_transit_distance_m;
    const ageShare = row.pct_age_20_39;

    return {
      targetSuccessful: numberValue(row.target_is_successful),
      features: {
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
      },
    };
  });

  const featureStats = Object.fromEntries(
    modelFeatureNames.map((name) => {
      const values = engineeredRows.map((row) => row.features[name]);
      return [name, { mean: mean(values), std: std(values) }];
    }),
  );

  const firstPass = engineeredRows.map((row) => [
    ...modelFeatureNames.map((name) => {
      const stats = featureStats[name];
      return (row.features[name] - stats.mean) / stats.std;
    }),
  ]);

  const scalerMeans = firstPass[0].map((_, index) => mean(firstPass.map((row) => row[index])));
  const scalerStds = firstPass[0].map((_, index) => std(firstPass.map((row) => row[index])));

  const rowsOut = engineeredRows.map((row, rowIndex) => {
    const vector = firstPass[rowIndex].map((value, featureIndex) =>
      quantize((value - scalerMeans[featureIndex]) / scalerStds[featureIndex]),
    );
    return [
      vector,
      row.targetSuccessful,
    ];
  });

  const numericRanges = Object.fromEntries(
    numericColumns.map((column) => {
      const values = imputed.map((row) => numberValue(row[column])).filter((value) => value !== null);
      return [column, [quantize(Math.min(...values), 2), quantize(Math.max(...values), 2)]];
    }),
  );

  return {
    modelFeatureNames,
    featureStats: Object.fromEntries(
      Object.entries(featureStats).map(([key, stats]) => [
        key,
        { mean: quantize(stats.mean, 8), std: quantize(stats.std, 8) },
      ]),
    ),
    imputeValues: Object.fromEntries(
      numericColumns.map((column) => [column, quantize(mean(imputed.map((row) => numberValue(row[column]))), 3)]),
    ),
    numericRanges,
    scalerMeans: scalerMeans.map((value) => quantize(value, 8)),
    scalerStds: scalerStds.map((value) => quantize(value, 8)),
    rows: rowsOut,
  };
}

function buildBoostedSuccessArtifact(knn) {
  const learningRate = 0.18;
  const treeCount = 42;
  const featureRows = knn.rows.map((row) => row[0]);
  const targets = knn.rows.map((row) => row[1]);
  const positiveCount = targets.reduce((total, value) => total + value, 0);
  const negativeCount = targets.length - positiveCount;
  const baseLogit = Math.log((positiveCount + 0.5) / (negativeCount + 0.5));
  const predictions = Array(targets.length).fill(baseLogit);
  const trees = [];

  for (let index = 0; index < treeCount; index += 1) {
    const residuals = targets.map((target, rowIndex) => target - sigmoid(predictions[rowIndex]));
    const nodes = trainRegressionTree(featureRows, residuals, {
      maxDepth: 2,
      minSamplesLeaf: 35,
      minGain: 1e-7,
    });

    for (let rowIndex = 0; rowIndex < featureRows.length; rowIndex += 1) {
      predictions[rowIndex] += learningRate * predictRegressionTree(nodes, featureRows[rowIndex]);
    }

    trees.push(nodes);
  }

  return {
    modelFeatureNames: knn.modelFeatureNames,
    trainingRows: targets.length,
    baseLogit: quantize(baseLogit, 10),
    learningRate,
    threshold: 0.5,
    trees,
  };
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let bestRow = pivotIndex;
    for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
      if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[bestRow][pivotIndex])) {
        bestRow = rowIndex;
      }
    }

    if (bestRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[bestRow]] = [augmented[bestRow], augmented[pivotIndex]];
    }

    const pivot = augmented[pivotIndex][pivotIndex] || 1e-12;
    for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
      augmented[pivotIndex][columnIndex] /= pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }

      const factor = augmented[rowIndex][pivotIndex];
      for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function fitRidge(rows, targets, alpha) {
  const featureCount = rows[0].length;
  const xtx = Array.from({ length: featureCount }, () => Array(featureCount).fill(0));
  const xty = Array(featureCount).fill(0);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const target = targets[rowIndex];

    for (let left = 0; left < featureCount; left += 1) {
      xty[left] += row[left] * target;
      for (let right = 0; right < featureCount; right += 1) {
        xtx[left][right] += row[left] * row[right];
      }
    }
  }

  for (let index = 1; index < featureCount; index += 1) {
    xtx[index][index] += alpha;
  }

  return solveLinearSystem(xtx, xty);
}

function buildRidgeRatingArtifact(rows) {
  const alpha = 10.0;
  const numericFeatures = ["median_income", "latitude", "longitude"];
  const categoricalFeatures = ["city", "primary_category", "price_level"];

  const usable = imputeRows(
    rows.filter((row) => numberValue(row.target_rating) !== null),
    numericFeatures,
  );

  const categoryValues = Object.fromEntries(
    categoricalFeatures.map((feature) => [
      feature,
      [...new Set(usable.map((row) => String(row[feature] ?? "")).filter(Boolean))].sort(),
    ]),
  );

  const numericStats = Object.fromEntries(
    numericFeatures.map((feature) => {
      const values = usable.map((row) => numberValue(row[feature]));
      return [feature, { mean: mean(values), std: std(values) }];
    }),
  );

  const featureRows = usable.map((row) => {
    const numericValues = numericFeatures.map((feature) => {
      const stats = numericStats[feature];
      return (numberValue(row[feature]) - stats.mean) / stats.std;
    });

    const categoricalValues = categoricalFeatures.flatMap((feature) =>
      categoryValues[feature].map((value) => (String(row[feature] ?? "") === value ? 1 : 0)),
    );

    return [1, ...numericValues, ...categoricalValues];
  });

  const targets = usable.map((row) => numberValue(row.target_rating));
  const [intercept, ...coefficients] = fitRidge(featureRows, targets, alpha);

  return {
    alpha,
    trainingRows: usable.length,
    numericFeatures,
    categoricalFeatures,
    numericStats: Object.fromEntries(
      Object.entries(numericStats).map(([key, stats]) => [
        key,
        { mean: quantize(stats.mean, 8), std: quantize(stats.std, 8) },
      ]),
    ),
    categoryValues,
    intercept: quantize(intercept, 10),
    coefficients: coefficients.map((value) => quantize(value, 10)),
  };
}

function buildDecisionTreeRatingArtifact(rows) {
  const numericFeatures = ["latitude", "longitude"];
  const categoricalFeatures = ["city", "primary_category"];

  const usable = rows.filter((row) => numberValue(row.target_rating) !== null);
  const numericImputeValues = Object.fromEntries(
    numericFeatures.map((feature) => [feature, median(usable.map((row) => numberValue(row[feature])))]),
  );
  const categoricalImputeValues = Object.fromEntries(
    categoricalFeatures.map((feature) => [feature, mode(usable.map((row) => row[feature]))]),
  );
  const categoryValues = Object.fromEntries(
    categoricalFeatures.map((feature) => [
      feature,
      [...new Set(usable.map((row) => String(row[feature] || categoricalImputeValues[feature])).filter(Boolean))]
        .sort(),
    ]),
  );
  const featureNames = [
    ...numericFeatures,
    ...categoricalFeatures.flatMap((feature) => categoryValues[feature].map((value) => `${feature}=${value}`)),
  ];

  const featureRows = usable.map((row) => {
    const numericValues = numericFeatures.map((feature) => numberValue(row[feature]) ?? numericImputeValues[feature]);
    const categoricalValues = categoricalFeatures.flatMap((feature) => {
      const currentValue = String(row[feature] || categoricalImputeValues[feature]);
      return categoryValues[feature].map((value) => (currentValue === value ? 1 : 0));
    });

    return [...numericValues, ...categoricalValues];
  });
  const targets = usable.map((row) => numberValue(row.target_rating));

  return {
    maxDepth: 4,
    minSamplesLeaf: 30,
    trainingRows: usable.length,
    numericFeatures,
    categoricalFeatures,
    numericImputeValues: Object.fromEntries(
      Object.entries(numericImputeValues).map(([key, value]) => [key, quantize(value, 8)]),
    ),
    categoricalImputeValues,
    categoryValues,
    featureNames,
    nodes: trainRegressionTree(featureRows, targets, {
      maxDepth: 4,
      minSamplesLeaf: 30,
    }),
  };
}

function buildReviewArtifact(rows) {
  const usable = rows
    .map((row) => ({
      city: row.city,
      category: row.primary_category,
      priceLevel: numberValue(row.price_level),
      latitude: numberValue(row.latitude),
      longitude: numberValue(row.longitude),
      reviewCount: numberValue(row.review_count),
    }))
    .filter((row) =>
      row.city &&
      row.category &&
      row.priceLevel !== null &&
      row.latitude !== null &&
      row.longitude !== null &&
      row.reviewCount !== null,
    );

  const categoryLabels = [...new Set(usable.map((row) => row.category))].sort();

  return {
    categoryLabels,
    rows: usable.map((row) => [
      row.city,
      row.category,
      row.priceLevel,
      quantize(row.latitude, 7),
      quantize(row.longitude, 7),
      quantize(Math.log1p(row.reviewCount), 6),
    ]),
  };
}

const [yelpText, locationSource] = await Promise.all([
  readFile(yelpPath, "utf8"),
  readFirstExisting(repoRoot, locationSourceCandidates),
]);

const yelpRows = parseCsv(yelpText);
const locationRows = parseCsv(locationSource.text);
const knn = buildKnnArtifact(yelpRows);
const boosted = buildBoostedSuccessArtifact(knn);
const rating = buildRidgeRatingArtifact(locationRows);
const decisionTreeRating = buildDecisionTreeRatingArtifact(locationRows);
const reviews = buildReviewArtifact(locationRows);

const output = `// Generated from https://github.com/preethi-ca/CMPT310_Project on ${new Date().toISOString()}.
// Source files: ${yelpSourceFile}, ${locationSource.sourceFile}.

export type KNNTrainingRow = [number[], number];
export type ReviewDemandRow = [string, string, number, number, number, number];
export type TreeNode = {
  value: number;
  featureIndex?: number;
  threshold?: number;
  left?: number;
  right?: number;
};

export const projectModelMetadata: {
  sourceRepo: string;
  yelpSourceFile: string;
  locationSourceFile: string;
  yelpRows: number;
  locationRows: number;
  ratingTrainingRows: number;
  classificationTrainingRows: number;
  reviewTrainingRows: number;
} = ${JSON.stringify(
  {
    sourceRepo: "https://github.com/preethi-ca/CMPT310_Project",
    yelpSourceFile,
    locationSourceFile: locationSource.sourceFile,
    yelpRows: yelpRows.length,
    locationRows: locationRows.length,
    ratingTrainingRows: rating.trainingRows,
    classificationTrainingRows: knn.rows.length,
    reviewTrainingRows: reviews.rows.length,
  },
  null,
  2,
)} ;

export const knnModelArtifact: {
  modelFeatureNames: string[];
  featureStats: Record<string, { mean: number; std: number }>;
  imputeValues: Record<string, number>;
  numericRanges: Record<string, [number, number]>;
  scalerMeans: number[];
  scalerStds: number[];
  rows: KNNTrainingRow[];
} = ${JSON.stringify(knn)};

export const ridgeRatingArtifact: {
  alpha: number;
  trainingRows: number;
  numericFeatures: string[];
  categoricalFeatures: string[];
  numericStats: Record<string, { mean: number; std: number }>;
  categoryValues: Record<string, string[]>;
  intercept: number;
  coefficients: number[];
} = ${JSON.stringify(rating)};

export const decisionTreeRatingArtifact: {
  maxDepth: number;
  minSamplesLeaf: number;
  trainingRows: number;
  numericFeatures: string[];
  categoricalFeatures: string[];
  numericImputeValues: Record<string, number>;
  categoricalImputeValues: Record<string, string>;
  categoryValues: Record<string, string[]>;
  featureNames: string[];
  nodes: TreeNode[];
} = ${JSON.stringify(decisionTreeRating)};

export const boostedSuccessArtifact: {
  modelFeatureNames: string[];
  trainingRows: number;
  baseLogit: number;
  learningRate: number;
  threshold: number;
  trees: TreeNode[][];
} = ${JSON.stringify(boosted)};

export const reviewDemandArtifact: {
  categoryLabels: string[];
  rows: ReviewDemandRow[];
} = ${JSON.stringify(reviews)};
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, output);
console.log(`Wrote ${outPath}`);
console.log(`Location source: ${locationSource.sourceFile}`);
console.log(`Ridge rating rows: ${rating.trainingRows}`);
console.log(`Decision tree rating rows: ${decisionTreeRating.trainingRows}`);
console.log(`KNN rows: ${knn.rows.length}`);
console.log(`Boosted classifier rows: ${boosted.trainingRows}`);
console.log(`Review rows: ${reviews.rows.length}`);

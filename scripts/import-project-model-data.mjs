import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.argv[2];

if (!repoRoot) {
  console.error("Usage: node scripts/import-project-model-data.mjs <CMPT310_Project repo path>");
  process.exit(1);
}

const yelpPath = path.join(repoRoot, "yelp-and-demo-info.csv");
const locationPath = path.join(repoRoot, "location-information.csv");
const outPath = path.resolve("app/model-data/projectModelRows.ts");

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

function buildKnnArtifact(rows) {
  const numericColumns = [
    "median_income",
    "pop_density_sqkm",
    "competitor_count_500m",
    "nearest_transit_distance_m",
  ];
  const imputed = imputeRows(rows, numericColumns).filter((row) => {
    return numberValue(row.target_rating) !== null && numberValue(row.target_is_successful) !== null;
  });

  const cityLabels = [...new Set(imputed.map((row) => row.city).filter(Boolean))].sort();
  const engineeredFeatureNames = [
    "log_median_income",
    "log_pop_density_sqkm",
    "log_competitor_count_500m",
    "log_nearest_transit_distance_m",
    "income_density_ratio",
    "competition_transit_ratio",
  ];

  const engineeredRows = imputed.map((row) => {
    const medianIncome = row.median_income;
    const popDensity = row.pop_density_sqkm;
    const competitorCount = row.competitor_count_500m;
    const transitDistance = row.nearest_transit_distance_m;

    return {
      city: row.city,
      targetRating: numberValue(row.target_rating),
      targetSuccessful: numberValue(row.target_is_successful),
      features: {
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
    engineeredFeatureNames.map((name) => {
      const values = engineeredRows.map((row) => row.features[name]);
      return [name, { mean: mean(values), std: std(values) }];
    }),
  );

  const firstPass = engineeredRows.map((row) => [
    ...cityLabels.map((city) => (row.city === city ? 1 : 0)),
    ...engineeredFeatureNames.map((name) => {
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
      quantize(row.targetRating, 2),
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
    cityLabels,
    engineeredFeatureNames,
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

const [yelpText, locationText] = await Promise.all([
  readFile(yelpPath, "utf8"),
  readFile(locationPath, "utf8"),
]);

const yelpRows = parseCsv(yelpText);
const locationRows = parseCsv(locationText);
const knn = buildKnnArtifact(yelpRows);
const reviews = buildReviewArtifact(locationRows);

const output = `// Generated from https://github.com/preethi-ca/CMPT310_Project on ${new Date().toISOString()}.
// Source files: yelp-and-demo-info.csv, location-information.csv.

export type KNNTrainingRow = [number[], number, number];
export type ReviewDemandRow = [string, string, number, number, number, number];

export const projectModelMetadata: {
  sourceRepo: string;
  yelpRows: number;
  classificationTrainingRows: number;
  reviewTrainingRows: number;
} = ${JSON.stringify(
  {
    sourceRepo: "https://github.com/preethi-ca/CMPT310_Project",
    yelpRows: yelpRows.length,
    classificationTrainingRows: knn.rows.length,
    reviewTrainingRows: reviews.rows.length,
  },
  null,
  2,
)} ;

export const knnModelArtifact: {
  cityLabels: string[];
  engineeredFeatureNames: string[];
  featureStats: Record<string, { mean: number; std: number }>;
  imputeValues: Record<string, number>;
  numericRanges: Record<string, [number, number]>;
  scalerMeans: number[];
  scalerStds: number[];
  rows: KNNTrainingRow[];
} = ${JSON.stringify(knn)};

export const reviewDemandArtifact: {
  categoryLabels: string[];
  rows: ReviewDemandRow[];
} = ${JSON.stringify(reviews)};
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, output);
console.log(`Wrote ${outPath}`);
console.log(`KNN rows: ${knn.rows.length}`);
console.log(`Review rows: ${reviews.rows.length}`);

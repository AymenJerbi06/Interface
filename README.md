# CMPT 310 Location AI Interface

Team website prototype for the CMPT 310 AI Introduction project interface.

The app lets a user enter a Metro Vancouver restaurant or cafe location, adjust generated feature values, and view the two current model outputs: expected Yelp rating and success/non-success classification.

The current visual direction is inspired by Wealthsimple Predict for styling only: dark hero area, muted neutral/sage palette, large rounded typography, soft motion, guided workflow tabs, and polished summary cards adapted to restaurant-location decisions.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

## Project Context

Reference repository: `https://github.com/preethi-ca/CMPT310_Project`

The current version uses browser-side replicas generated from the reference repo CSVs. Expected Yelp rating uses the Ridge regression feature set from `linear-regression.py`, trained on 550 `location-information.csv` rows and `target_rating`. Success/non-success classification uses the KNN feature-engineering path from `project_helper.py` and `knn_classification.py`, trained on 1,535 `yelp-and-demo-info.csv` rows and `target_is_successful`.

The two outputs use different feature sets. The interface labels generated inputs by model usage so it is clear that changing a field can affect one output without affecting the other. The `location-information.csv` category labels are also used to keep the category dropdown aligned with the project dataset, not as a visible review-demand output.

The reference repo currently contains training scripts, CSVs, and charts, but no exported `.pkl`, `.joblib`, `.json`, or API-ready trained model files. When the team exports trained Ridge/KNN/XGBoost/Decision Tree artifacts, the interface can replace the local adapter with a server/API route that loads those artifacts.

To refresh the bundled model data after the GitHub repo changes:

```bash
git clone https://github.com/preethi-ca/CMPT310_Project.git ../CMPT310_Project
node scripts/import-project-model-data.mjs ../CMPT310_Project
```

## Deployment Notes

This app can be deployed as a static/reactive site because prediction currently runs in TypeScript in the browser. Vercel is a good option for a public class demo. Resend is not needed unless the team adds email features such as contact forms, reports, or notifications.

## Interface Includes

- Address, city, category, price, demographic, competition, and transit inputs
- Real OpenStreetMap/Leaflet map with clickable Metro Vancouver example locations
- Generated feature summary matching the project columns
- Data-backed outputs for expected Yelp rating and success/non-success classification
- A clear generated-feature table labeled as model inputs, not extra outputs

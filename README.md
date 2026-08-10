# CMPT 310 Location AI Interface

Team website prototype for the CMPT 310 AI Introduction project interface.

The app lets a user enter a Metro Vancouver restaurant or cafe location, choose which project model to use, adjust generated feature values, and view the two model outputs: expected Yelp rating and success/non-success classification.

The current visual direction is inspired by Wealthsimple Predict for styling only: dark animated opening section, muted neutral/sage palette, large rounded typography, soft motion, and polished summary cards adapted to restaurant-location decisions. The working model interface stays simple and directly below the opening section.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

## Project Context

Reference repository: `https://github.com/preethi-ca/CMPT310_Project`

The current version uses browser-side replicas generated from the reference repo CSVs. Expected Yelp rating can use the Linear/Ridge Regression path from `linear-regression.py` or the Decision Tree Regression path from `decision-tree.py`, both trained on 550 `location-information-with-competitors.csv` rows and `target_rating`. Success/non-success classification can use the KNN path from `knn_classification.py` or a browser-side boosted-tree replica of the XGBoost path from `xgboost_classification.py`, both using 1,535 `yelp-and-demo-info.csv` rows and `target_is_successful`.

The two outputs use different feature sets. The interface labels generated inputs by model usage so it is clear that changing a field can affect one output without affecting the other. The `location-information-with-competitors.csv` category labels are also used to keep the category dropdown aligned with the project dataset, not as a visible review-demand output.

The reference repo currently contains training scripts, CSVs, and charts, but no exported `.pkl`, `.joblib`, `.json`, or API-ready trained model files. When the team exports trained Ridge/KNN/XGBoost/Decision Tree artifacts, the interface can replace the local browser replicas with a server/API route that loads those exact artifacts.

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
- Selectors for Linear/Ridge Regression versus Decision Tree rating and KNN versus XGBoost-style success classification
- A clear generated-feature table labeled as model inputs, not extra outputs
- No decorative navigation buttons or instruction cards that look clickable without changing the model output

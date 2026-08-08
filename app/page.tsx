"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronRight,
  Menu,
  Pause,
  Play,
  Search,
} from "lucide-react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { predictLocation, projectModelMetadata } from "./projectModel";

type CityName =
  | "Vancouver"
  | "Richmond"
  | "Surrey"
  | "Burnaby"
  | "New Westminster"
  | "Coquitlam";

type AreaType = "Campus" | "Downtown" | "Mall" | "Transit" | "Suburban";
type GuideKey = "Explore" | "Features" | "Results";
type GuardrailKey = "inputs" | "models" | "limits";

type LocationInput = {
  address: string;
  city: CityName;
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

type Preset = LocationInput & {
  label: string;
  areaType: AreaType;
};

const cityDefaults: Record<
  CityName,
  Pick<LocationInput, "latitude" | "longitude" | "medianIncome" | "popDensity" | "ageShare">
> = {
  Vancouver: {
    latitude: 49.2827,
    longitude: -123.1207,
    medianIncome: 51336,
    popDensity: 5344,
    ageShare: 33.1,
  },
  Richmond: {
    latitude: 49.1666,
    longitude: -123.1336,
    medianIncome: 31729,
    popDensity: 11873,
    ageShare: 29.1,
  },
  Surrey: {
    latitude: 49.1913,
    longitude: -122.849,
    medianIncome: 40421,
    popDensity: 4230,
    ageShare: 31.8,
  },
  Burnaby: {
    latitude: 49.2488,
    longitude: -122.9805,
    medianIncome: 33789,
    popDensity: 11655,
    ageShare: 39.4,
  },
  "New Westminster": {
    latitude: 49.2057,
    longitude: -122.911,
    medianIncome: 42140,
    popDensity: 5430,
    ageShare: 35.2,
  },
  Coquitlam: {
    latitude: 49.2838,
    longitude: -122.7932,
    medianIncome: 36650,
    popDensity: 5893,
    ageShare: 27.8,
  },
};

const categories = [
  "Cafes",
  "Japanese",
  "Chinese",
  "Canadian (New)",
  "Vietnamese",
  "Sushi Bars",
  "Pizza",
  "Korean",
  "Seafood",
  "Indian",
  "Breakfast & Brunch",
  "Coffee & Tea",
  "Desserts",
  "Burgers",
  "Thai",
];

const presets: Preset[] = [
  {
    label: "Downtown Vancouver cafe",
    address: "Robson St, Vancouver, BC",
    city: "Vancouver",
    category: "Cafes",
    priceLevel: 2,
    latitude: 49.2827,
    longitude: -123.1207,
    medianIncome: 51336,
    popDensity: 5344,
    ageShare: 33.1,
    competitorCount: 19,
    transitDistance: 180,
    areaType: "Downtown",
  },
  {
    label: "Metrotown sushi bar",
    address: "Kingsway, Burnaby, BC",
    city: "Burnaby",
    category: "Sushi Bars",
    priceLevel: 2,
    latitude: 49.2302,
    longitude: -123.0039,
    medianIncome: 33789,
    popDensity: 11655,
    ageShare: 39.4,
    competitorCount: 16,
    transitDistance: 240,
    areaType: "Mall",
  },
  {
    label: "Richmond Chinese restaurant",
    address: "No. 3 Rd, Richmond, BC",
    city: "Richmond",
    category: "Chinese",
    priceLevel: 1,
    latitude: 49.1839,
    longitude: -123.1338,
    medianIncome: 30867,
    popDensity: 2404,
    ageShare: 49.5,
    competitorCount: 13,
    transitDistance: 320,
    areaType: "Transit",
  },
  {
    label: "Surrey family restaurant",
    address: "King George Blvd, Surrey, BC",
    city: "Surrey",
    category: "Indian",
    priceLevel: 2,
    latitude: 49.1913,
    longitude: -122.849,
    medianIncome: 40421,
    popDensity: 4230,
    ageShare: 31.8,
    competitorCount: 8,
    transitDistance: 460,
    areaType: "Suburban",
  },
  {
    label: "Coquitlam coffee shop",
    address: "Pinetree Way, Coquitlam, BC",
    city: "Coquitlam",
    category: "Coffee & Tea",
    priceLevel: 2,
    latitude: 49.2836,
    longitude: -122.7983,
    medianIncome: 36650,
    popDensity: 5893,
    ageShare: 27.8,
    competitorCount: 6,
    transitDistance: 520,
    areaType: "Campus",
  },
  {
    label: "New West brunch spot",
    address: "Columbia St, New Westminster, BC",
    city: "New Westminster",
    category: "Breakfast & Brunch",
    priceLevel: 2,
    latitude: 49.2057,
    longitude: -122.911,
    medianIncome: 42140,
    popDensity: 5430,
    ageShare: 35.2,
    competitorCount: 10,
    transitDistance: 260,
    areaType: "Transit",
  },
];

const guideContent: Record<GuideKey, { title: string; text: string; stat: string }> = {
  Explore: {
    title: "Choose a restaurant or cafe location",
    text: "Start from a real Metro Vancouver example, type an address, or click the map to set a custom point.",
    stat: "6 cities",
  },
  Features: {
    title: "Generate the project features",
    text: "The interface exposes city, category, income, density, age, competition, transit, coordinates, and price level.",
    stat: "8 feature groups",
  },
  Results: {
    title: "Read model outputs together",
    text: "Expected rating, success probability, review demand, and feature readiness are presented in one place.",
    stat: "4 outputs",
  },
};

const guardrails: Array<{
  key: GuardrailKey;
  title: string;
  text: string;
}> = [
  {
    key: "inputs",
    title: "Built from the project plan",
    text: "The UI stays focused on Aymen's task: entering/selecting a location, preparing features, and showing model output.",
  },
  {
    key: "models",
    title: "Compare the model families",
    text: "Regression, classification, and review-demand outputs are separated so the user can understand what each model is answering.",
  },
  {
    key: "limits",
    title: "Clear about prototype limits",
    text: "The current score is a browser-side prototype until the team exports trained model files or a prediction API.",
  },
];

const modelRows = [
  {
    label: "Primary answer",
    ridge: "Expected Yelp rating",
    classification: "Successful or not",
    demand: "Estimated review demand",
  },
  {
    label: "Target column",
    ridge: "target_rating",
    classification: "target_is_successful",
    demand: "log(1 + review_count)",
  },
  {
    label: "Useful input",
    ridge: "City, category, price, income",
    classification: "Competition, transit, density",
    demand: "Location, category, price",
  },
  {
    label: "Displayed as",
    ridge: "Rating out of 5.0",
    classification: "Success probability",
    demand: "Estimated reviews",
  },
];

const chartAssets = [
  {
    src: "/model-assets/r2_vs_lambda.png",
    title: "Ridge R2 by lambda",
    alt: "Line chart showing Ridge regression R squared across lambda values.",
  },
  {
    src: "/model-assets/rmse_vs_lambda.png",
    title: "Ridge RMSE by lambda",
    alt: "Line chart showing Ridge regression RMSE across lambda values.",
  },
  {
    src: "/model-assets/mae_vs_lambda.png",
    title: "Ridge MAE by lambda",
    alt: "Line chart showing Ridge regression MAE across lambda values.",
  },
  {
    src: "/model-assets/knn_performance_vs_k.png",
    title: "KNN performance by k",
    alt: "KNN performance chart across different k values.",
  },
  {
    src: "/model-assets/knn_confusion_matrix.png",
    title: "KNN confusion matrix",
    alt: "KNN confusion matrix heatmap.",
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 0,
  }).format(value);
}

function distanceSquared(latA: number, lngA: number, latB: number, lngB: number) {
  return (latA - latB) ** 2 + (lngA - lngB) ** 2;
}

function nearestPreset(latitude: number, longitude: number) {
  return presets.reduce((best, preset) => {
    const bestDistance = distanceSquared(latitude, longitude, best.latitude, best.longitude);
    const presetDistance = distanceSquared(latitude, longitude, preset.latitude, preset.longitude);
    return presetDistance < bestDistance ? preset : best;
  }, presets[0]);
}

function MapPicker({
  input,
  onPresetSelect,
  onMapSelect,
}: {
  input: LocationInput;
  onPresetSelect: (preset: Preset) => void;
  onMapSelect: (latitude: number, longitude: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const selectedMarkerRef = useRef<LeafletMarker | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!containerRef.current || mapRef.current) {
        return;
      }

      const L = await import("leaflet");
      if (cancelled || !containerRef.current) {
        return;
      }

      const map = L.map(containerRef.current, {
        center: [49.245, -122.995],
        zoom: 10,
        zoomControl: false,
        minZoom: 9,
        maxZoom: 18,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const presetIcon = L.divIcon({
        className: "leaflet-preset-icon",
        html: "<span></span>",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const selectedIcon = L.divIcon({
        className: "leaflet-selected-icon",
        html: "<span></span>",
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      presets.forEach((preset) => {
        L.marker([preset.latitude, preset.longitude], { icon: presetIcon })
          .addTo(map)
          .bindTooltip(preset.label, { direction: "top", offset: [0, -12] })
          .on("click", () => onPresetSelect(preset));
      });

      selectedMarkerRef.current = L.marker([input.latitude, input.longitude], {
        icon: selectedIcon,
        zIndexOffset: 1000,
      }).addTo(map);

      map.on("click", (event) => {
        onMapSelect(Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5)));
      });

      mapRef.current = map;
    }

    setupMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      selectedMarkerRef.current = null;
    };
  }, [onMapSelect, onPresetSelect]);

  useEffect(() => {
    async function updateMarker() {
      if (!mapRef.current || !selectedMarkerRef.current) {
        return;
      }

      const L = await import("leaflet");
      const latLng = L.latLng(input.latitude, input.longitude);
      selectedMarkerRef.current.setLatLng(latLng);
      mapRef.current.panTo(latLng, { animate: true, duration: 0.45 });
    }

    updateMarker();
  }, [input.latitude, input.longitude]);

  return <div ref={containerRef} className="real-map" aria-label="OpenStreetMap location selector" />;
}

export default function Home() {
  const [input, setInput] = useState<LocationInput>(presets[0]);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].label);
  const [runState, setRunState] = useState("Ready for input");
  const [activeGuide, setActiveGuide] = useState<GuideKey>("Explore");
  const [activeGuardrail, setActiveGuardrail] = useState<GuardrailKey>("inputs");
  const [tickerPaused, setTickerPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const result = useMemo(() => predictLocation(input), [input]);
  const currentGuide = guideContent[activeGuide];
  const activePreset = presets.find((preset) => preset.label === selectedPreset);

  const signalTape = useMemo(
    () => [
      {
        label: "Success probability",
        context: input.city,
        value: `${result.successProbability}%`,
        detail: result.verdict,
      },
      {
        label: "Expected Yelp rating",
        context: input.category,
        value: result.rating.toFixed(2),
        detail: "out of 5.0",
      },
      {
        label: "Predicted review demand",
        context: "Demand",
        value: `${result.reviewDemand}`,
        detail: "estimated reviews",
      },
      {
        label: "Nearest transit distance",
        context: "Access",
        value: `${input.transitDistance}m`,
        detail: "from location",
      },
      {
        label: "Competitors in 500m",
        context: "Competition",
        value: `${input.competitorCount}`,
        detail: "nearby businesses",
      },
    ],
    [
      input.category,
      input.city,
      input.competitorCount,
      input.transitDistance,
      result.rating,
      result.reviewDemand,
      result.successProbability,
      result.verdict,
    ],
  );

  useEffect(() => {
    const section = document.querySelector<HTMLElement>(".guardrail-section");
    if (!section) {
      return;
    }

    const updateGuardrail = () => {
      const rect = section.getBoundingClientRect();
      const scrollableDistance = Math.max(rect.height - window.innerHeight, 1);
      const progress = clamp((0 - rect.top) / scrollableDistance, 0, 0.999);
      const index = Math.min(guardrails.length - 1, Math.floor(progress * guardrails.length));
      setActiveGuardrail(guardrails[index].key);
    };

    updateGuardrail();
    window.addEventListener("scroll", updateGuardrail, { passive: true });
    window.addEventListener("resize", updateGuardrail);

    return () => {
      window.removeEventListener("scroll", updateGuardrail);
      window.removeEventListener("resize", updateGuardrail);
    };
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    setInput({ ...preset });
    setSelectedPreset(preset.label);
    setRunState("Preset loaded");
  }, []);

  const applyMapPoint = useCallback((latitude: number, longitude: number) => {
    const nearest = nearestPreset(latitude, longitude);
    const defaults = cityDefaults[nearest.city];
    const mapDistance = Math.sqrt(distanceSquared(latitude, longitude, nearest.latitude, nearest.longitude));

    setInput((current) => ({
      ...current,
      ...defaults,
      address: `Dropped pin near ${nearest.city}`,
      city: nearest.city,
      latitude,
      longitude,
      competitorCount: clamp(Math.round(nearest.competitorCount + mapDistance * 90), 0, 35),
      transitDistance: clamp(Math.round(nearest.transitDistance + mapDistance * 1800), 80, 1400),
    }));
    setSelectedPreset("Custom map point");
    setRunState("Map point selected");
  }, []);

  function updateNumber(field: keyof LocationInput, value: string) {
    setInput((current) => ({
      ...current,
      [field]: Number(value),
    }));
    setSelectedPreset("Custom location");
    setRunState("Edited");
  }

  function updateCity(city: CityName) {
    const defaults = cityDefaults[city];
    setInput((current) => ({
      ...current,
      ...defaults,
      city,
      address: `${city}, BC`,
    }));
    setSelectedPreset("Custom location");
    setRunState("Edited");
  }

  function runModels() {
    setRunState("Model set refreshed");
  }

  function focusLocationInput() {
    const inputElement = document.getElementById("location-address") as HTMLInputElement | null;
    inputElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    inputElement?.focus({ preventScroll: true });
  }

  return (
    <main>
      <section className="hero" id="predict" aria-labelledby="hero-title">
        <div className="hero-noise" aria-hidden="true" />
        <header className="topbar">
          <a className="brand" href="#predict" aria-label="CMPT 310 LocationAI home">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className="brand-word">LocationAI</span>
          </a>

          <nav className="topnav" aria-label="Primary navigation">
            <button className="icon-button" type="button" onClick={focusLocationInput} aria-label="Find location input">
              <Search size={22} strokeWidth={2.25} />
            </button>
            <a className="nav-pill" href="#map">
              Open interface
            </a>
            <a className="nav-pill primary" href="#models">
              View models
            </a>
            <button
              className="icon-button"
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              aria-expanded={menuOpen}
              aria-label="Open section menu"
            >
              <Menu size={24} strokeWidth={2.25} />
            </button>
          </nav>

          {menuOpen ? (
            <div className="menu-popover">
              <a href="#map" onClick={() => setMenuOpen(false)}>
                Map and inputs
              </a>
              <a href="#results" onClick={() => setMenuOpen(false)}>
                Results
              </a>
              <a href="#models" onClick={() => setMenuOpen(false)}>
                Model comparison
              </a>
              <a href="#visuals" onClick={() => setMenuOpen(false)}>
                Visuals
              </a>
            </div>
          ) : null}
        </header>

        <div className="hero-content">
          <div className="hero-copy">
            <p className="product-lockup">
              <BarChart3 size={24} strokeWidth={2.25} />
              CMPT 310 interface
            </p>
            <h1 id="hero-title">Predict restaurant location success.</h1>
            <p>
              Select a Metro Vancouver restaurant or cafe location, generate project features, and compare the
              model outputs in one interactive interface.
            </p>
            <div className="hero-actions">
              <a className="store-pill" href="#map">
                <span>Start with</span>
                Map input
              </a>
              <a className="store-pill" href="#models">
                <span>Review</span>
                Model logic
              </a>
            </div>
          </div>

        </div>

        <div className={tickerPaused ? "signal-ticker paused" : "signal-ticker"} aria-label="Model signal ticker">
          {[...signalTape, ...signalTape].map((item, index) => (
            <article className="ticker-card" key={`${item.label}-${index}`}>
              <span>{item.context}</span>
              <p>{item.label}</p>
              <div>
                <strong>{item.value}</strong>
                <em>{item.detail}</em>
              </div>
            </article>
          ))}
        </div>

        <button
          className="floating-control"
          type="button"
          onClick={() => setTickerPaused((current) => !current)}
          aria-label={tickerPaused ? "Resume ticker animation" : "Pause ticker animation"}
        >
          {tickerPaused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
        </button>
      </section>

      <section className="statement-section" aria-labelledby="statement-title">
        <h2 id="statement-title">
          Have a restaurant idea in Metro Vancouver? Turn it into a model-backed location forecast.
        </h2>
      </section>

      <section className="interface-section" id="map" aria-labelledby="interface-title">
        <div className="section-kicker">How the interface works</div>
        <div className="interface-grid">
          <div className="interface-tabs" role="tablist" aria-label="Interface workflow">
            {(Object.keys(guideContent) as GuideKey[]).map((key) => (
              <button
                aria-selected={activeGuide === key}
                className={activeGuide === key ? "workflow-tab active" : "workflow-tab"}
                key={key}
                onClick={() => setActiveGuide(key)}
                role="tab"
                type="button"
              >
                {key}
              </button>
            ))}
          </div>

          <section className="map-phone" aria-label="Metro Vancouver map picker">
            <div className="phone-topline">
              <span>Map selection</span>
              <strong>
                {input.latitude.toFixed(4)}, {input.longitude.toFixed(4)}
              </strong>
            </div>
            <MapPicker input={input} onPresetSelect={applyPreset} onMapSelect={applyMapPoint} />
            <div className="phone-bottomline">
              <span>{activePreset?.areaType ?? "Custom"}</span>
              <strong>{input.address}</strong>
            </div>
          </section>

          <article className="workflow-copy">
            <span>{currentGuide.stat}</span>
            <h3>{currentGuide.title}</h3>
            <p>{currentGuide.text}</p>
          </article>
        </div>
      </section>

      <section className="input-results-section" id="results" aria-labelledby="results-title">
        <div className="input-panel">
          <div className="panel-heading">
            <div>
              <span>Location input</span>
              <small className="panel-status" aria-live="polite">
                {runState}
              </small>
            </div>
            <strong>{selectedPreset}</strong>
          </div>

          <label className="field wide-field" htmlFor="location-address">
            <span>Address or area</span>
            <input
              id="location-address"
              value={input.address}
              onChange={(event) => {
                setInput((current) => ({ ...current, address: event.target.value }));
                setSelectedPreset("Custom location");
                setRunState("Edited");
              }}
              placeholder="Example: Robson St, Vancouver, BC"
            />
          </label>

          <div className="preset-row" aria-label="Example locations">
            {presets.map((preset) => (
              <button
                className={preset.label === selectedPreset ? "preset-button active" : "preset-button"}
                key={preset.label}
                onClick={() => applyPreset(preset)}
                type="button"
              >
                <span>{preset.areaType}</span>
                {preset.city}
              </button>
            ))}
          </div>

          <div className="field-grid">
            <label className="field">
              <span>City</span>
              <select value={input.city} onChange={(event) => updateCity(event.target.value as CityName)}>
                {Object.keys(cityDefaults).map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Category</span>
              <select
                value={input.category}
                onChange={(event) => {
                  setInput((current) => ({ ...current, category: event.target.value }));
                  setSelectedPreset("Custom location");
                  setRunState("Edited");
                }}
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Price level</span>
              <select value={input.priceLevel} onChange={(event) => updateNumber("priceLevel", event.target.value)}>
                <option value={1}>1 - budget</option>
                <option value={2}>2 - moderate</option>
                <option value={3}>3 - premium</option>
                <option value={4}>4 - high end</option>
              </select>
            </label>

            <label className="field">
              <span>Median income</span>
              <input
                min={25000}
                max={70000}
                step={500}
                type="number"
                value={input.medianIncome}
                onChange={(event) => updateNumber("medianIncome", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Population density</span>
              <input
                min={1000}
                max={15000}
                step={100}
                type="number"
                value={input.popDensity}
                onChange={(event) => updateNumber("popDensity", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Age 20-39 percent</span>
              <input
                min={10}
                max={65}
                step={0.1}
                type="number"
                value={input.ageShare}
                onChange={(event) => updateNumber("ageShare", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Competitors 500m</span>
              <input
                min={0}
                max={40}
                type="number"
                value={input.competitorCount}
                onChange={(event) => updateNumber("competitorCount", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Nearest transit meters</span>
              <input
                min={0}
                max={2000}
                step={10}
                type="number"
                value={input.transitDistance}
                onChange={(event) => updateNumber("transitDistance", event.target.value)}
              />
            </label>
          </div>

          <button className="primary-action" type="button" onClick={runModels}>
            Refresh prediction
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="results-board">
          <div className="board-heading">
            <span>Model output</span>
            <h2 id="results-title">{result.verdict} location signal</h2>
            <p className="model-source">
              Powered by {formatNumber(projectModelMetadata.classificationTrainingRows)} GitHub training rows and{" "}
              {formatNumber(projectModelMetadata.reviewTrainingRows)} review-demand rows.
            </p>
          </div>

          <div className="metric-grid">
            <article className="metric-card highlight">
              <span>Expected Yelp rating</span>
              <strong>{result.rating.toFixed(2)} / 5.0</strong>
              <div className="bar" aria-label={`Expected rating ${result.rating.toFixed(2)} out of 5`}>
                <span style={{ width: `${result.ratingPercent}%` }} />
              </div>
            </article>

            <article className="metric-card">
              <span>Success probability</span>
              <strong>{result.successProbability}%</strong>
              <div className="bar" aria-label={`Success probability ${result.successProbability} percent`}>
                <span style={{ width: `${result.successProbability}%` }} />
              </div>
            </article>

            <article className="metric-card">
              <span>Predicted review demand</span>
              <strong>{result.reviewDemand}</strong>
              <small>estimated reviews</small>
            </article>

            <article className="metric-card">
              <span>Feature readiness</span>
              <strong>{result.featureReadiness}%</strong>
              <small>input completeness signal</small>
            </article>
          </div>

          <div className="feature-table" aria-label="Generated features">
            <div>
              <span>city</span>
              <strong>{input.city}</strong>
            </div>
            <div>
              <span>primary_category</span>
              <strong>{input.category}</strong>
            </div>
            <div>
              <span>median_income</span>
              <strong>${formatNumber(input.medianIncome)}</strong>
            </div>
            <div>
              <span>pop_density_sqkm</span>
              <strong>{formatNumber(input.popDensity)}</strong>
            </div>
            <div>
              <span>pct_age_20_39</span>
              <strong>{input.ageShare}%</strong>
            </div>
            <div>
              <span>competitor_count_500m</span>
              <strong>{input.competitorCount}</strong>
            </div>
            <div>
              <span>nearest_transit_distance_m</span>
              <strong>{input.transitDistance}</strong>
            </div>
            <div>
              <span>price_level</span>
              <strong>{input.priceLevel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="guardrail-section" aria-labelledby="guardrail-title">
        <div className="guardrail-sticky">
          <h2 id="guardrail-title">
            A model interface <span>that explains its signal</span>
          </h2>
          <div className="guardrail-copy">
            {guardrails.map((item) => (
              <article
                className={activeGuardrail === item.key ? "guardrail-item active" : "guardrail-item"}
                data-step={item.key}
                key={item.key}
              >
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="model-compare-section" id="models" aria-labelledby="models-title">
        <h2 id="models-title">
          How the project models stack up against each other
        </h2>
        <div className="model-table" role="table" aria-label="Model comparison">
          <div className="table-row table-head" role="row">
            <div role="columnheader" />
            <div role="columnheader">Ridge regression</div>
            <div className="featured-column" role="columnheader">
              KNN and XGBoost
            </div>
            <div role="columnheader">Decision tree</div>
          </div>

          {modelRows.map((row) => (
            <div className="table-row" role="row" key={row.label}>
              <div role="cell">{row.label}</div>
              <div role="cell">{row.ridge}</div>
              <div className="featured-column" role="cell">
                {row.classification}
              </div>
              <div role="cell">{row.demand}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="visual-section" id="visuals" aria-labelledby="visuals-title">
        <div className="resource-heading">
          <h2 id="visuals-title">Project visuals and model evidence</h2>
          <p>
            Charts from the GitHub repository, kept as supporting context for the interface.
          </p>
        </div>

        <div className="resource-strip">
          {chartAssets.map((chart) => (
            <figure className="resource-card" key={chart.src}>
              <img src={chart.src} alt={chart.alt} />
              <figcaption>
                <span>{chart.title}</span>
                <a href={chart.src}>View chart</a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="footer">
        <a className="brand footer-brand" href="#predict" aria-label="CMPT 310 LocationAI home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">LocationAI</span>
        </a>
        <p>CMPT 310 - D200 Introduction to Artificial Intelligence</p>
        <strong>Aymen&apos;s interface milestone</strong>
      </footer>
    </main>
  );
}

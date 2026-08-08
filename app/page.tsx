"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronRight,
  Menu,
  Search,
} from "lucide-react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { predictLocation, projectCategoryLabels, projectModelMetadata } from "./projectModel";

type CityName =
  | "Vancouver"
  | "Richmond"
  | "Surrey"
  | "Burnaby"
  | "New Westminster"
  | "Coquitlam";

type GuideKey = "Explore" | "Features" | "Results";

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

const categories = projectCategoryLabels;

const presets: Preset[] = [
  {
    label: "Vancouver cafe",
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
  },
  {
    label: "Burnaby sushi bar",
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
  },
  {
    label: "Surrey Indian restaurant",
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
  },
];

const guideContent: Record<GuideKey, { title: string; text: string; stat: string }> = {
  Explore: {
    title: "Choose a restaurant or cafe location",
    text: "Type an address, choose the city and category, or click the map to set a custom point.",
    stat: "6 cities",
  },
  Features: {
    title: "Generate the project features",
    text: "The interface exposes city, category, income, density, age, competition, transit, coordinates, and price level.",
    stat: "8 feature groups",
  },
  Results: {
    title: "Read the two model outputs",
    text: "The interface shows expected Yelp rating and success classification from the current data-backed adapter.",
    stat: "2 outputs",
  },
};

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
  const initialMarkerRef = useRef({ latitude: input.latitude, longitude: input.longitude });
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

      selectedMarkerRef.current = L.marker([initialMarkerRef.current.latitude, initialMarkerRef.current.longitude], {
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
  const [runState, setRunState] = useState("Ready for input");
  const [activeGuide, setActiveGuide] = useState<GuideKey>("Explore");
  const [menuOpen, setMenuOpen] = useState(false);

  const result = useMemo(() => predictLocation(input), [input]);
  const currentGuide = guideContent[activeGuide];

  const applyPreset = useCallback((preset: Preset) => {
    setInput({ ...preset });
    setRunState("Example loaded");
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
    setRunState("Map point selected");
  }, []);

  function updateNumber(field: keyof LocationInput, value: string) {
    setInput((current) => ({
      ...current,
      [field]: Number(value),
    }));
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
            <a className="nav-pill primary" href="#results">
              View output
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
              Select a Metro Vancouver restaurant or cafe location and view the current expected Yelp rating and
              success classification from the project data.
            </p>
            <div className="hero-actions">
              <a className="store-pill" href="#map">
                <span>Start with</span>
                Map input
              </a>
              <a className="store-pill" href="#results">
                <span>Review</span>
                Model output
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="statement-section" aria-labelledby="statement-title">
        <h2 id="statement-title">
          Have a restaurant idea in Metro Vancouver? Estimate its Yelp rating and success class from the project data.
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
              <span>{input.city}</span>
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
          </div>

          <label className="field wide-field" htmlFor="location-address">
            <span>Address or area</span>
            <input
              id="location-address"
              value={input.address}
              onChange={(event) => {
                setInput((current) => ({ ...current, address: event.target.value }));
                setRunState("Edited");
              }}
              placeholder="Example: Robson St, Vancouver, BC"
            />
          </label>

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
            <h2 id="results-title">Location model results</h2>
            <p className="model-source">
              Current live outputs use a browser-side KNN-style nearest-neighbor adapter built from{" "}
              {formatNumber(projectModelMetadata.classificationTrainingRows)} project training rows. The expected Yelp
              rating is estimated from <code>target_rating</code>; success classification uses{" "}
              <code>target_is_successful</code>. Exported Python model files are not connected yet.
            </p>
          </div>

          <div className="metric-grid">
            <article className="metric-card highlight">
              <span>Expected Yelp rating</span>
              <strong>{result.rating.toFixed(2)} / 5.0</strong>
              <small>KNN-style estimate from similar rows</small>
              <div className="bar" aria-label={`Expected rating ${result.rating.toFixed(2)} out of 5`}>
                <span style={{ width: `${result.ratingPercent}%` }} />
              </div>
            </article>

            <article className="metric-card classification">
              <span>Success classification</span>
              <strong>{result.successClassification}</strong>
              <small>Classification label from <code>target_is_successful</code></small>
            </article>
          </div>

          <div className="feature-table-heading">
            <span>Generated input features</span>
            <small>These values are model inputs, not extra model outputs.</small>
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


import { useCallback, useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import hospitalImage from "./hospital.png";
import "leaflet/dist/leaflet.css";
import "./App.css";

type Coordinates = [number, number];
type CareType = "primary" | "urgent" | "emergency";

type Facility = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  careType: CareType;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

// Default location: Denville, New Jersey
const DENVILLE: Coordinates = [40.8923, -74.4774];

const facilityIcon = L.icon({
  iconUrl: hospitalImage,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
  popupAnchor: [0, -20],
});

const careLabels: Record<CareType, string> = {
  primary: "Primary Care",
  urgent: "Urgent Care",
  emergency: "Hospital",
};

function MapUpdater({
  position,
  selectedFacility,
}: {
  position: Coordinates;
  selectedFacility: Coordinates | null;
}) {
  const map = useMap();

  useEffect(() => {
    const target = selectedFacility ?? position;
    map.flyTo(target, selectedFacility ? 15 : 12, {
      duration: 1,
    });
  }, [
    position,
    selectedFacility,
    map,
  ]);

  return null;
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const radians = (degrees: number) =>
    (degrees * Math.PI) / 180;

  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    6371 *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function classifyFacility(
  tags: Record<string, string>,
): CareType | null {
  const amenity = (tags.amenity ?? "").toLowerCase();
  const healthcare = (tags.healthcare ?? "").toLowerCase();
  const name = (tags.name ?? "").toLowerCase();

  const speciality = (
    tags["healthcare:speciality"] ?? ""
  )
    .toLowerCase()
    .split(";")
    .map((value) => value.trim());

  if (
    healthcare === "urgent_care" ||
    amenity === "urgent_care" ||
    speciality.includes("urgent") ||
    speciality.includes("urgent_care") ||
    name.includes("urgent care")
  ) {
    return "urgent";
  }

  if (
    speciality.some((value) =>
      [
        "general",
        "primary",
        "general_practice",
        "family_medicine",
      ].includes(value),
    ) ||
    name.includes("primary care") ||
    name.includes("family practice") ||
    name.includes("family medicine") ||
    name.includes("general practice")
  ) {
    return "primary";
  }

  if (
    amenity === "hospital" ||
    healthcare === "hospital"
  ) {
    return "emergency";
  }

  return null;
}

function getAddress(
  tags: Record<string, string>,
): string | undefined {
  if (tags["addr:full"]) return tags["addr:full"];

  const street = [
    tags["addr:housenumber"],
    tags["addr:street"],
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [
    street,
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : undefined;
}

function createFacility(
  item: OverpassElement,
): Facility | null {
  const lat = item.lat ?? item.center?.lat;
  const lon = item.lon ?? item.center?.lon;

  if (lat == null || lon == null) return null;

  const tags = item.tags ?? {};
  const careType = classifyFacility(tags);

  if (!careType) return null;

  return {
    id: item.id,
    name: tags.name ?? "Unnamed healthcare facility",
    lat,
    lon,
    address: getAddress(tags),
    phone: tags.phone ?? tags["contact:phone"],
    careType,
  };
}

export default function App() {
  const [position, setPosition] =
    useState<Coordinates>(DENVILLE);

  const [facilities, setFacilities] =
    useState<Facility[]>([]);

  const [selectedType, setSelectedType] =
    useState<CareType | "all">("all");

  const [selectedFacility, setSelectedFacility] =
    useState<Facility | null>(null);

  const [status, setStatus] = useState(
    "Loading healthcare facilities near Denville, NJ...",
  );

  const [loading, setLoading] = useState(false);

  // Search for hospitals and other healthcare facilities
  // around the supplied coordinates.
  const searchFacilities = useCallback(
    async (location: Coordinates) => {
      const [lat, lon] = location;

      setPosition(location);
      setFacilities([]);
      setSelectedFacility(null);
      setLoading(true);
      setStatus("Searching for nearby healthcare facilities...");

      const query = `
        [out:json][timeout:25];
        (
          nwr["amenity"~"^(hospital|urgent_care|doctors|clinic)$"]
            (around:15000,${lat},${lon});
          nwr["healthcare"~"^(hospital|urgent_care|doctor|doctors|clinic|centre|center)$"]
            (around:15000,${lat},${lon});
          nwr["healthcare:speciality"~"urgent",i]
            (around:15000,${lat},${lon});
        );
        out center tags;
      `;

      try {
        const response = await fetch(
          "https://overpass-api.de/api/interpreter",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: new URLSearchParams({
              data: query,
            }).toString(),
          },
        );

        if (!response.ok) {
          throw new Error(
            "The map service is busy. Please try again shortly.",
          );
        }

        const data: {
          elements?: OverpassElement[];
        } = await response.json();

        const results = (data.elements ?? [])
          .map(createFacility)
          .filter(
            (facility): facility is Facility =>
              facility !== null,
          );

        // Remove duplicate records.
        const unique = new Map<string, Facility>();

        for (const facility of results) {
          const name = facility.name.trim().toLowerCase();

          const locationKey =
            `${facility.lat.toFixed(4)},${facility.lon.toFixed(4)}`;

          const key =
            name === "unnamed healthcare facility"
              ? locationKey
              : `${name}|${locationKey}`;

          if (!unique.has(key)) {
            unique.set(key, facility);
          }
        }

        // Sort facilities from nearest to farthest.
        const sorted = Array.from(unique.values()).sort(
          (a, b) =>
            distanceKm(lat, lon, a.lat, a.lon) -
            distanceKm(lat, lon, b.lat, b.lon),
        );

        setFacilities(sorted);

        setStatus(
          sorted.length
            ? `Found ${sorted.length} mapped facilities within 15 km.`
            : "No matching facilities were found within 15 km. Try again later.",
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Something went wrong while searching.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Automatically search Denville when the app opens.
  useEffect(() => {
    void searchFacilities(DENVILLE);
  }, [searchFacilities]);

  // Let users search around their actual device location.
  const findMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus(
        "Your browser does not support location services.",
      );
      return;
    }

    setLoading(true);
    setStatus("Requesting your location...");

    navigator.geolocation.getCurrentPosition(
      (location) => {
        void searchFacilities([
          location.coords.latitude,
          location.coords.longitude,
        ]);
      },
      (error) => {
        setLoading(false);

        if (error.code === error.PERMISSION_DENIED) {
          setStatus(
            "Location permission was denied. You can still use the Denville map.",
          );
        } else if (error.code === error.TIMEOUT) {
          setStatus(
            "Finding your location took too long. Please try again.",
          );
        } else {
          setStatus(
            "Unable to find your location. You can still use the Denville map.",
          );
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000,
      },
    );
  }, [searchFacilities]);

  const filteredFacilities =
    selectedType === "all"
      ? facilities
      : facilities.filter(
          (facility) => facility.careType === selectedType,
        );

  const nearest = filteredFacilities[0];

  function selectFacility(facility: Facility) {
    setSelectedFacility(facility);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand-text">
          <h1>Med-Finder</h1>
          <p>Find nearby healthcare, when it matters.</p>
        </div>
      </header>

      <div className="emergency-banner" role="note">
        <strong>Medical emergency?</strong> If someone is in
        immediate, life-threatening danger in the US, call 911.
      </div>

      <main className="content">
        <section className="map-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR AREA</span>
              <h2>Healthcare map</h2>
            </div>

            <span className="result-count">
              {filteredFacilities.length} results
            </span>
          </div>

          <button
            className="location-button"
            onClick={findMyLocation}
            disabled={loading}
          >
            {loading
              ? "Searching..."
              : "Find facilities near me"}
          </button>

          <button
            className="text-button"
            onClick={() => void searchFacilities(DENVILLE)}
            disabled={loading}
          >
            Back to Denville, NJ
          </button>

          <p className="status" role="status">
            {status}
          </p>

          <div className="filter-section">
            <label htmlFor="care-filter">
              Filter by type of care
            </label>

            <select
              id="care-filter"
              value={selectedType}
              onChange={(event) => {
                setSelectedType(
                  event.target.value as CareType | "all",
                );
                setSelectedFacility(null);
              }}
            >
              <option value="all">All facilities</option>
              <option value="primary">Primary care</option>
              <option value="urgent">Urgent care</option>
              <option value="emergency">Hospitals</option>
            </select>
          </div>

          <MapContainer
            center={DENVILLE}
            zoom={13}
            className="map"
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapUpdater
              position={position}
              selectedFacility={
                selectedFacility
                  ? [
                      selectedFacility.lat,
                      selectedFacility.lon,
                    ]
                  : null
              }
            />

            {filteredFacilities.map((facility) => (
              <Marker
                key={`${facility.careType}-${facility.id}`}
                position={[facility.lat, facility.lon]}
                icon={facilityIcon}
                eventHandlers={{
                  click: () => selectFacility(facility),
                }}
              >
                <Popup>
                  <strong>{facility.name}</strong>
                  <p>{careLabels[facility.careType]}</p>
                  <button
                    type="button"
                    onClick={() => selectFacility(facility)}
                  >
                    View details
                  </button>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          <p className="map-caption">
            Map data © OpenStreetMap contributors. Listings may be
            incomplete; verify facility services before travelling.
          </p>
        </section>

        <aside className="data-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NEARBY OPTIONS</span>
              <h2>
                {selectedType === "all"
                  ? "Healthcare facilities"
                  : careLabels[selectedType]}
              </h2>
            </div>
          </div>

          {nearest && (
            <div className="data-card nearest-card">
              <span className="eyebrow">
                CLOSEST LISTED OPTION
              </span>
              <h3>{nearest.name}</h3>
              <p>{careLabels[nearest.careType]}</p>
              <p className="distance">
                {distanceKm(
                  position[0],
                  position[1],
                  nearest.lat,
                  nearest.lon,
                ).toFixed(1)}{" "}
                km in a straight line
              </p>
              <button
                className="text-button"
                onClick={() => selectFacility(nearest)}
              >
                View facility details →
              </button>
            </div>
          )}

          {filteredFacilities.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon"></span>
              <h3>No facilities to show yet</h3>
              <p>
                {loading
                  ? "Loading nearby facilities..."
                  : facilities.length === 0
                    ? "No facilities were loaded. Try searching again."
                    : "No facilities match this filter. Try another type of care."}
              </p>
            </div>
          ) : (
            <div className="facility-list">
              {filteredFacilities.map((facility) => (
                <article
                  key={`${facility.careType}-${facility.id}`}
                  className={`data-card facility-card ${
                    selectedFacility?.id === facility.id
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => selectFacility(facility)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" ||
                      event.key === " "
                    ) {
                      event.preventDefault();
                      selectFacility(facility);
                    }
                  }}
                >
                  <div className="facility-card-top">
                    <div className="mini-cross" aria-hidden="true">
                      +
                    </div>

                    <div className="facility-card-title">
                      <h3>{facility.name}</h3>
                      <span className="care-label">
                        {careLabels[facility.careType]}
                      </span>
                    </div>
                  </div>

                  {facility.address && (
                    <p className="facility-address">
                      {facility.address}
                    </p>
                  )}

                  <p className="distance">
                    {distanceKm(
                      position[0],
                      position[1],
                      facility.lat,
                      facility.lon,
                    ).toFixed(1)}{" "}
                    km away in a straight line
                  </p>

                  <span className="card-action-hint">
                    Select for details and directions →
                  </span>
                </article>
              ))}
            </div>
          )}
        </aside>
      </main>

      {selectedFacility && (
        <div
          className="drawer-backdrop"
          onClick={() => setSelectedFacility(null)}
        >
          <aside
            className="facility-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="drawer-close"
              onClick={() => setSelectedFacility(null)}
              aria-label="Close facility details"
            >
              ×
            </button>

            <span className="eyebrow">
              {careLabels[selectedFacility.careType]}
            </span>

            <h2 id="drawer-title">
              {selectedFacility.name}
            </h2>

            <div className="drawer-info">
              <strong>Address</strong>
              <p>
                {selectedFacility.address ??
                  "No address is listed in the available map data."}
              </p>
            </div>

            <div className="drawer-info">
              <strong>Phone</strong>
              <p>
                {selectedFacility.phone ? (
                  <a href={`tel:${selectedFacility.phone}`}>
                    {selectedFacility.phone}
                  </a>
                ) : (
                  "No phone number is listed in the available map data."
                )}
              </p>
            </div>

            <div className="drawer-info">
              <strong>Distance</strong>
              <p>
                {distanceKm(
                  position[0],
                  position[1],
                  selectedFacility.lat,
                  selectedFacility.lon,
                ).toFixed(1)}{" "}
                km in a straight line; actual travel distance may differ.
              </p>
            </div>

            <a
              className="drawer-primary-button"
              href={`https://www.google.com/maps/dir/?api=1&origin=${position[0]},${position[1]}&destination=${selectedFacility.lat},${selectedFacility.lon}&travelmode=driving`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get directions ↗
            </a>

            <div className="transport-section">
              <div className="transport-icon" aria-hidden="true">
                ↗
              </div>

              <h3>Need help getting there?</h3>
              <p>
                Explore community resources that may help you find
                transportation. Availability and eligibility vary.
              </p>

              <a
                className="drawer-secondary-button"
                href="https://www.211.org/"
                target="_blank"
                rel="noreferrer"
              >
                Explore transportation help ↗
              </a>
            </div>

            <p className="drawer-disclaimer">
              Information comes from public map data and may be
              incomplete or outdated. Confirm facility services,
              hours, and transportation availability before relying
              on them. Med-Finder does not book rides or verify
              emergency department availability.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

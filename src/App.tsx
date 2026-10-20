

import { useEffect, useState } from "react";
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

type Hospital = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
};

const hospitalIcon = L.icon({
  iconUrl: hospitalImage,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
  popupAnchor: [0, -24],
});

function MapUpdater({
  position,
}: {
  position: Coordinates | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, 12);
    }
  }, [position, map]);

  return null;
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function App() {
  const [position, setPosition] =
    useState<Coordinates | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [status, setStatus] = useState(
    "Click the button to find nearby hospitals."
  );
  const [loading, setLoading] = useState(false);

  function findMyLocation() {
    if (!navigator.geolocation) {
      setStatus("Your browser does not support location services.");
      return;
    }

    setStatus("Finding your location...");

    navigator.geolocation.getCurrentPosition(
      async (location) => {
        const coords: Coordinates = [
          location.coords.latitude,
          location.coords.longitude,
        ];

        setPosition(coords);
        setHospitals([]);
        setLoading(true);
        setStatus("Searching for nearby hospitals...");

        try {
          const [lat, lon] = coords;

          const query = `
            [out:json][timeout:25];
            (
              node["amenity"="hospital"](around:15000,${lat},${lon});
              way["amenity"="hospital"](around:15000,${lat},${lon});
              relation["amenity"="hospital"](around:15000,${lat},${lon});
            );
            out center tags;
          `;

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
            }
          );

          if (!response.ok) {
            throw new Error(
              "Hospital service unavailable. Please try again."
            );
          }

          const data = await response.json();

          const results: Hospital[] = data.elements
            .map((item: any): Hospital | null => {
              const hospitalLat = item.lat ?? item.center?.lat;
              const hospitalLon = item.lon ?? item.center?.lon;

              if (
                hospitalLat == null ||
                hospitalLon == null
              ) {
                return null;
              }

              const tags = item.tags ?? {};

              const address =
                tags["addr:full"] ??
                  (
                    [
                      tags["addr:housenumber"],
                      tags["addr:street"],
                      tags["addr:city"],
                    ]
                    .filter(Boolean)
                    .join(" ") || undefined
                  );

              return {
                id: item.id,
                name: tags.name ?? "Unnamed hospital",
                lat: hospitalLat,
                lon: hospitalLon,
                address,
                phone: tags.phone,
              };
            })
            .filter(
              (hospital: Hospital | null): hospital is Hospital =>
                hospital !== null
            );

          results.sort(
            (a, b) =>
              distanceKm(lat, lon, a.lat, a.lon) -
              distanceKm(lat, lon, b.lat, b.lon)
          );

          setHospitals(results);

          setStatus(
            results.length > 0
              ? `Found ${results.length} mapped hospitals within 15 km.`
              : "No mapped hospitals found within 15 km. Try again later or search a wider area."
          );
        } catch (error) {
          setStatus(
            error instanceof Error
              ? error.message
              : "Something went wrong while searching for hospitals."
          );
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        setStatus(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied. Allow location access in your browser settings."
            : "Unable to get your location. Please try again."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      }
    );
  }

  const nearest = hospitals[0];

  return (
    <div className="app">
      <header className="header">
        <h1>Med-Finder</h1>
        <p>Find nearby healthcare facilities.</p>
      </header>

      <main className="content">
        <section className="map-section">
          <h2>Hospital Map</h2>

          <button
            className="location-button"
            onClick={findMyLocation}
            disabled={loading}
          >
            {loading ? "Searching..." : "Find Hospitals Near Me"}
          </button>

          <p className="status" role="status">
            {status}
          </p>

          <MapContainer
            center={[39.8283, -98.5795]}
            zoom={4}
            className="map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapUpdater position={position} />

            {position && (
              <Marker position={position}>
                <Popup>Your location</Popup>
              </Marker>
            )}

            {hospitals.map((hospital) => (
              <Marker
                key={hospital.id}
                position={[hospital.lat, hospital.lon]}
                icon={hospitalIcon}
              >
                <Popup>
                  <strong>{hospital.name}</strong>
                  {hospital.address && <p>{hospital.address}</p>}
                  {hospital.phone && <p>{hospital.phone}</p>}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>

        <aside className="data-section">
          <h2>Nearby Hospitals</h2>

          {nearest && position && (
            <div className="data-card nearest-card">
              <h3>Closest listed hospital</h3>
              <strong>{nearest.name}</strong>
              <p>
                {distanceKm(
                  position[0],
                  position[1],
                  nearest.lat,
                  nearest.lon
                ).toFixed(1)}{" "}
                km away in a straight line
              </p>
            </div>
          )}

          {hospitals.map((hospital) => (
            <article className="data-card" key={hospital.id}>
              <h3>{hospital.name}</h3>

              {hospital.address && <p>{hospital.address}</p>}

              {hospital.phone && (
                <p>
                  Phone:{" "}
                  <a href={`tel:${hospital.phone}`}>
                    {hospital.phone}
                  </a>
                </p>
              )}

              {position && (
                <p>
                  Distance:{" "}
                  {distanceKm(
                    position[0],
                    position[1],
                    hospital.lat,
                    hospital.lon
                  ).toFixed(1)}{" "}
                  km
                </p>
              )}
            </article>
          ))}
        </aside>
      </main>
    </div>
  );
}

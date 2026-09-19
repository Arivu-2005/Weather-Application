// ===============================
// Skyline Weather — JavaScript
// REST API: Open-Meteo (https://open-meteo.com)
// Free, no API key required, CORS-enabled.
// ===============================

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REVERSE_GEOCODE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const RECENTS_KEY = "skyline-weather-recents";
const UNIT_KEY = "skyline-weather-unit";
const MAX_RECENTS = 6;

// -------------------------------
// Weather code -> icon / label / theme
// Codes follow the WMO standard used by Open-Meteo.
// -------------------------------
function getWeatherInfo(code, isDay) {
  const table = {
    0: { text: "Clear sky", icon: "☀️", theme: "clear" },
    1: { text: "Mostly clear", icon: "🌤️", theme: "clear" },
    2: { text: "Partly cloudy", icon: "⛅", theme: "cloud" },
    3: { text: "Overcast", icon: "☁️", theme: "cloud" },
    45: { text: "Fog", icon: "🌫️", theme: "cloud" },
    48: { text: "Depositing rime fog", icon: "🌫️", theme: "cloud" },
    51: { text: "Light drizzle", icon: "🌦️", theme: "rain" },
    53: { text: "Moderate drizzle", icon: "🌦️", theme: "rain" },
    55: { text: "Dense drizzle", icon: "🌧️", theme: "rain" },
    56: { text: "Freezing drizzle", icon: "🌧️", theme: "rain" },
    57: { text: "Freezing drizzle (dense)", icon: "🌧️", theme: "rain" },
    61: { text: "Slight rain", icon: "🌦️", theme: "rain" },
    63: { text: "Moderate rain", icon: "🌧️", theme: "rain" },
    65: { text: "Heavy rain", icon: "🌧️", theme: "rain" },
    66: { text: "Freezing rain", icon: "🌧️", theme: "rain" },
    67: { text: "Freezing rain (heavy)", icon: "🌧️", theme: "rain" },
    71: { text: "Slight snow fall", icon: "🌨️", theme: "snow" },
    73: { text: "Moderate snow fall", icon: "🌨️", theme: "snow" },
    75: { text: "Heavy snow fall", icon: "❄️", theme: "snow" },
    77: { text: "Snow grains", icon: "❄️", theme: "snow" },
    80: { text: "Slight rain showers", icon: "🌦️", theme: "rain" },
    81: { text: "Moderate rain showers", icon: "🌧️", theme: "rain" },
    82: { text: "Violent rain showers", icon: "⛈️", theme: "rain" },
    85: { text: "Slight snow showers", icon: "🌨️", theme: "snow" },
    86: { text: "Heavy snow showers", icon: "❄️", theme: "snow" },
    95: { text: "Thunderstorm", icon: "⛈️", theme: "rain" },
    96: { text: "Thunderstorm + hail", icon: "⛈️", theme: "rain" },
    99: { text: "Thunderstorm + heavy hail", icon: "⛈️", theme: "rain" },
  };

  const info = table[code] || { text: "Unknown", icon: "🌡️", theme: "clear" };

  // Night takes priority over the base theme, except heavy weather.
  if (isDay === 0 && (info.theme === "clear" || info.theme === "cloud")) {
    return { ...info, theme: "night", icon: info.theme === "clear" ? "🌙" : "☁️" };
  }
  return info;
}

// -------------------------------
// App state
// -------------------------------
const state = {
  unit: localStorage.getItem(UNIT_KEY) || "C",
  lastWeatherData: null, // keeps raw Celsius data so unit toggle can re-render without refetching
};

// -------------------------------
// DOM references
// -------------------------------
const els = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("cityInput"),
  locateBtn: document.getElementById("locateBtn"),
  unitToggle: document.getElementById("unitToggle"),
  recentRow: document.getElementById("recentRow"),
  recentChips: document.getElementById("recentChips"),
  status: document.getElementById("status"),
  hero: document.getElementById("hero"),
  forecast: document.getElementById("forecast"),
  emptyState: document.getElementById("emptyState"),
  placeName: document.getElementById("placeName"),
  placeMeta: document.getElementById("placeMeta"),
  tempValue: document.getElementById("tempValue"),
  tempUnit: document.getElementById("tempUnit"),
  conditionText: document.getElementById("conditionText"),
  feelsLike: document.getElementById("feelsLike"),
  humidity: document.getElementById("humidity"),
  wind: document.getElementById("wind"),
  uvIndex: document.getElementById("uvIndex"),
  weatherIcon: document.getElementById("weatherIcon"),
  forecastStrip: document.getElementById("forecastStrip"),
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  renderRecents();
  updateUnitToggleLabel();

  els.form.addEventListener("submit", onSearchSubmit);
  els.locateBtn.addEventListener("click", onLocateClick);
  els.unitToggle.addEventListener("click", onUnitToggle);
}

// -------------------------------
// Event handlers
// -------------------------------
async function onSearchSubmit(event) {
  event.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  await searchCity(query);
}

async function onLocateClick() {
  if (!navigator.geolocation) {
    showStatus("Geolocation isn't supported in this browser.", true);
    return;
  }

  showStatus("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const place = await reverseGeocode(latitude, longitude);
      await loadWeather(latitude, longitude, place);
    },
    () => {
      showStatus("Couldn't get your location. Please allow location access, or search a city instead.", true);
    }
  );
}

function onUnitToggle() {
  state.unit = state.unit === "C" ? "F" : "C";
  localStorage.setItem(UNIT_KEY, state.unit);
  updateUnitToggleLabel();

  if (state.lastWeatherData) {
    renderWeather(state.lastWeatherData);
  }
}

function updateUnitToggleLabel() {
  els.unitToggle.textContent = state.unit === "C" ? "°C  /  °F" : "°F  /  °C";
}

// -------------------------------
// API calls
// -------------------------------
async function searchCity(query) {
  showStatus("Searching for \u201c" + query + "\u201d…");

  try {
    const url = GEOCODE_URL + "?name=" + encodeURIComponent(query) + "&count=1&language=en&format=json";
    const response = await fetch(url);
    if (!response.ok) throw new Error("Geocoding request failed");

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      showStatus("No place found for \u201c" + query + "\u201d. Try a different spelling.", true);
      return;
    }

    const result = data.results[0];
    const place = {
      name: result.name,
      region: [result.admin1, result.country].filter(Boolean).join(", "),
    };

    saveRecent(result.name);
    await loadWeather(result.latitude, result.longitude, place);
  } catch (err) {
    console.error(err);
    showStatus("Something went wrong while searching. Please try again.", true);
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const url = REVERSE_GEOCODE_URL + "?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=en";
    const response = await fetch(url);
    if (!response.ok) throw new Error("Reverse geocoding failed");

    const data = await response.json();
    const name = data.city || data.locality || "Current location";
    const region = [data.principalSubdivision, data.countryName].filter(Boolean).join(", ");
    return { name, region };
  } catch (err) {
    console.warn("Reverse geocoding unavailable, falling back to coordinates.", err);
    return { name: "Current location", region: lat.toFixed(2) + ", " + lon.toFixed(2) };
  }
}

async function loadWeather(lat, lon, place) {
  showStatus("Loading forecast…");

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current_weather: "true",
      hourly: "relativehumidity_2m,uv_index",
      daily: "weathercode,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
    });

    const response = await fetch(FORECAST_URL + "?" + params.toString());
    if (!response.ok) throw new Error("Forecast request failed");

    const data = await response.json();
    state.lastWeatherData = { ...data, place };
    renderWeather(state.lastWeatherData);
    hideStatus();
  } catch (err) {
    console.error(err);
    showStatus("Couldn't load the forecast right now. Please try again in a moment.", true);
  }
}

// -------------------------------
// Rendering
// -------------------------------
function renderWeather(data) {
  const current = data.current_weather;
  const info = getWeatherInfo(current.weathercode, current.is_day);

  applyTheme(info.theme);

  els.emptyState.hidden = true;
  els.hero.hidden = false;
  els.forecast.hidden = false;

  els.placeName.textContent = data.place.name;
  els.placeMeta.textContent = data.place.region || "—";

  els.tempValue.textContent = formatTemp(current.temperature);
  els.tempUnit.textContent = "°" + state.unit;
  els.conditionText.textContent = info.text;
  els.weatherIcon.textContent = info.icon;

  // Humidity + UV: nearest hourly reading to "now"
  const nowIndex = findClosestHourIndex(data.hourly.time, current.time);
  els.humidity.textContent = data.hourly.relativehumidity_2m[nowIndex] + "%";
  els.uvIndex.textContent = Math.round(data.hourly.uv_index[nowIndex]);

  els.feelsLike.textContent = formatTemp(current.temperature) + "°";
  els.wind.textContent = Math.round(current.windspeed) + " km/h";

  renderForecast(data.daily);
}

function renderForecast(daily) {
  els.forecastStrip.innerHTML = daily.time
    .slice(0, 5)
    .map((dateStr, i) => {
      const info = getWeatherInfo(daily.weathercode[i], 1);
      const day = new Date(dateStr).toLocaleDateString(undefined, { weekday: "short" });
      const hi = formatTemp(daily.temperature_2m_max[i]);
      const lo = formatTemp(daily.temperature_2m_min[i]);

      return (
        '<div class="forecast-card">' +
          '<span class="forecast-day">' + day + '</span>' +
          '<span class="forecast-icon">' + info.icon + '</span>' +
          '<span class="forecast-range">' + hi + '° <span class="lo">' + lo + '°</span></span>' +
        '</div>'
      );
    })
    .join("");
}

function applyTheme(theme) {
  document.body.classList.remove("theme-night", "theme-cloud", "theme-rain", "theme-snow");
  if (theme === "night") document.body.classList.add("theme-night");
  else if (theme === "cloud") document.body.classList.add("theme-cloud");
  else if (theme === "rain") document.body.classList.add("theme-rain");
  else if (theme === "snow") document.body.classList.add("theme-snow");
}

function formatTemp(celsius) {
  const value = state.unit === "C" ? celsius : celsius * 9 / 5 + 32;
  return Math.round(value);
}

function findClosestHourIndex(hourlyTimes, currentTimeIso) {
  const target = new Date(currentTimeIso).getTime();
  let closestIndex = 0;
  let closestDiff = Infinity;

  hourlyTimes.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  });

  return closestIndex;
}

// -------------------------------
// Status / empty state helpers
// -------------------------------
function showStatus(message, isError) {
  els.status.hidden = false;
  els.status.textContent = message;
  els.status.classList.toggle("is-error", Boolean(isError));
  els.emptyState.hidden = true;

  if (isError) {
    els.hero.hidden = true;
    els.forecast.hidden = true;
  }
}

function hideStatus() {
  els.status.hidden = true;
}

// -------------------------------
// Recent searches (localStorage)
// -------------------------------
function getRecents() {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecent(cityName) {
  let recents = getRecents().filter((c) => c.toLowerCase() !== cityName.toLowerCase());
  recents.unshift(cityName);
  recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  renderRecents();
}

function renderRecents() {
  const recents = getRecents();
  els.recentRow.hidden = recents.length === 0;

  els.recentChips.innerHTML = recents
    .map((city) => '<button type="button" class="recent-chip">' + city + "</button>")
    .join("");

  els.recentChips.querySelectorAll(".recent-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.input.value = chip.textContent;
      searchCity(chip.textContent);
    });
  });
}

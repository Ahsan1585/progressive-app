// Loads the Google Maps JS API (Places library) exactly once, however many
// components on the page ask for it — shared promise so a second caller
// just awaits the first load instead of injecting a duplicate <script>.
let loadPromise = null;

export function loadGoogleMapsPlaces() {
  if (loadPromise) return loadPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    loadPromise = Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not configured.'));
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve(window.google.maps.places);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps.'));
    script.onload = () => {
      if (window.google?.maps?.places) resolve(window.google.maps.places);
      else reject(new Error('Google Maps loaded without the places library.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

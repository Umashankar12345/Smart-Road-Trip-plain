// Global variables
let map;
let routeLayer;
let startMarker;
let endMarker;
let markers = [];
let poiMarkers = []; // Unified marker management
let currentDistance = 0;
let currentGalleryIndex = 0;
let galleryImages = [];

// API keys are now loaded from deployment-config.js
// This allows them to be set via environment variables

// Initialize OpenRouteService clients
// Using the window.ORS_API_KEY set in deployment-config.js
const orsDirections = new Openrouteservice.Directions({
  api_key: window.ORS_API_KEY || ''
});
const orsGeocode = new Openrouteservice.Geocode({
  api_key: window.ORS_API_KEY || ''
});

// Map initialization function
function initMap() {
  // Set Mapbox access token from window.MAPBOX_ACCESS_TOKEN set in deployment-config.js
  mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN || '';
  console.log('Mapbox token being used:', mapboxgl.accessToken);

  // Initialize the map with center closer to a global view
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v10', // Dark theme for tech vibe
    center: [85.1, 25.6], // More central global view
    zoom: 6,
  });

  map.on('error', (e) => {
    console.error('Mapbox error:', e.error);
  });

  // Wait for map to load before adding event listeners
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  map.on('load', function () {
    console.log('Map loaded successfully!');
    // Add custom layers for route
    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      }
    });

    map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#19e6b3', // Changed to teal to match the new theme
        'line-width': 6,
        'line-opacity': 0.9,
      }
    });

    // Add form submit listener
    document.getElementById('trip-form').addEventListener('submit', (e) => {
      e.preventDefault();
      calculateRoute();
    });

    // Add toggle button listeners
    document.getElementById('toggle-gas').addEventListener('click', () => handlePOIToggle('fuel', 'gas'));
    document.getElementById('toggle-attractions').addEventListener('click', () => handlePOIToggle('tourism', 'attraction'));
    document.getElementById('toggle-restaurants').addEventListener('click', () => handlePOIToggle('restaurant', 'restaurant'));
    document.getElementById('toggle-hotels').addEventListener('click', () => handlePOIToggle('hotel', 'hotel'));

    // Add gallery control listeners
    document.getElementById('gallery-close').addEventListener('click', closeGallery);
    document.getElementById('prev-image').addEventListener('click', showPrevImage);
    document.getElementById('next-image').addEventListener('click', showNextImage);

    // Show example locations
    document.getElementById('start').placeholder = 'Enter starting location (e.g., New York, NY)';
    document.getElementById('end').placeholder = 'Enter destination (e.g., Los Angeles, CA)';
  });
}

// Unified POI handling
let lastRouteCoords = [];
let activePOITypes = new Set();

async function handlePOIToggle(category, type) {
  // Fix: Use correct icon IDs based on your HTML
  const iconId = type === 'gas' ? 'gas' :
    type === 'attraction' ? 'attractions' :
      type + 's'; // restaurants -> restaurants, hotels -> hotels
  const icon = document.getElementById(`${iconId}-icon`);

  if (activePOITypes.has(type)) {
    activePOITypes.delete(type);
    if (icon) icon.textContent = '🔴';
    removeMarkersByType(type);
    // Also clear the list in the UI
    clearPlacesList(type);
  } else {
    if (!lastRouteCoords || lastRouteCoords.length === 0) {
      alert("Please plan a route first!");
      return;
    }
    activePOITypes.add(type);
    if (icon) icon.textContent = '🟢';

    // Show loading state
    showPlacesLoading(type);

    // Map type to Overpass category key
    const categoryKey = type === 'gas' ? 'fuel' :
      type === 'attraction' ? 'attraction' :
        type === 'restaurant' ? 'restaurant' : 'hotel';

    const allPlaces = [];
    const searchPoints = getSearchPoints(lastRouteCoords);

    for (const point of searchPoints) {
      try {
        const places = await fetchPOIs(categoryKey, point);
        if (Array.isArray(places)) allPlaces.push(...places);
      } catch (err) {
        console.error(`Error fetching ${type} POIs at point:`, err);
      }
      await sleep(300);
    }

    // Remove duplicates by name/coordinates
    const uniquePlaces = removeDuplicatePlaces(allPlaces);

    // Limit to 5 results and add markers
    const placesToShow = uniquePlaces.slice(0, 5);
    placesToShow.forEach(place => addPlaceMarker(place, type));

    // Update the places list in the UI
    updatePlacesList(placesToShow, type);
  }
}

// Remove duplicate places
function removeDuplicatePlaces(places) {
  if (!Array.isArray(places)) return [];

  const seen = new Set();
  return places.filter(place => {
    if (!place) return false;
    const name = place.properties?.name || place.name || '';
    const coords = place.geometry?.coordinates || place.coordinates || [];
    const coordStr = Array.isArray(coords) ? coords.join(',') : '';
    const key = `${name}-${coordStr}`;
    if (seen.has(key) || !name || name === 'Unknown') return false;
    seen.add(key);
    return true;
  });
}

// Show loading state in places list
function showPlacesLoading(type) {
  let containerId;
  if (type === 'gas') containerId = 'gas-stations-list';
  else if (type === 'attraction') containerId = 'attractions-list';
  else if (type === 'restaurant') containerId = 'restaurants-list';
  else if (type === 'hotel') containerId = 'hotels-list';

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = '<p class="text-gray-400">Loading...</p>';
  }
}

// Clear places list
function clearPlacesList(type) {
  let containerId;
  if (type === 'gas') containerId = 'gas-stations-list';
  else if (type === 'attraction') containerId = 'attractions-list';
  else if (type === 'restaurant') containerId = 'restaurants-list';
  else if (type === 'hotel') containerId = 'hotels-list';

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = '<p>Click toggle to show places</p>';
  }
}

async function fetchPOIs(type, coords) {
  try {
    const response = await fetch('/api/pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coords, categories: [type] })
    });

    if (!response.ok) {
      console.error(`POI fetch failed with status: ${response.status}`);
      return [];
    }

    const data = await response.json();
    // Always return an array — guard against server returning non-array
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('POI Fetch Error:', error);
    return [];
  }
}

// Sleep helper to avoid rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sample only 3 points: start, middle, end — avoids rate limits
function getSearchPoints(coords) {
  if (!coords || coords.length < 3) return [];
  const start = coords[0];
  const middle = coords[Math.floor(coords.length / 2)];
  const end = coords[coords.length - 1];
  return [start, middle, end];
}

function removeMarkersByType(type) {
  poiMarkers = poiMarkers.filter(m => {
    if (m.type === type) {
      m.marker.remove();
      return false;
    }
    return true;
  });
}

function clearAllPOIMarkers() {
  poiMarkers.forEach(m => m.marker.remove());
  poiMarkers = [];
  activePOITypes.clear();

  // Reset all icons to red
  ['gas', 'attractions', 'restaurants', 'hotels'].forEach(id => {
    const icon = document.getElementById(`${id}-icon`);
    if (icon) icon.textContent = '🔴';
  });

  // Clear all lists
  ['gas-stations-list', 'attractions-list', 'restaurants-list', 'hotels-list'].forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      container.innerHTML = '<p>Click toggle to show places</p>';
    }
  });
}

// Calculate route between start and destination
async function calculateRoute() {
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;

  if (!start || !end) {
    alert('Please enter both start and destination locations.');
    return;
  }

  const loadingElement = document.getElementById('loading');
  loadingElement.classList.remove('hidden');
  clearMarkers();
  clearAllPOIMarkers(); // Clear all existing POIs

  try {
    // Geocode start location
    const startGeocode = await orsGeocode.geocode({
      text: start
    });

    const endGeocode = await orsGeocode.geocode({
      text: end
    });

    if (!startGeocode.features || startGeocode.features.length === 0) {
      throw new Error(`Could not find location: ${start}`);
    }

    if (!endGeocode.features || endGeocode.features.length === 0) {
      throw new Error(`Could not find location: ${end}`);
    }

    const startCoords = startGeocode.features[0].geometry.coordinates;
    const endCoords = endGeocode.features[0].geometry.coordinates;
    const startAddress = startGeocode.features[0].properties.label;
    const endAddress = endGeocode.features[0].properties.label;

    console.log('Start coordinates:', startCoords);
    console.log('End coordinates:', endCoords);

    // Calculate route
    await fetchRoute(startCoords, endCoords, startAddress, endAddress);

  } catch (error) {
    console.error('Error during route calculation:', error);
    alert(`Error: ${error.message || 'An error occurred while planning your route. Please try different locations.'}`);
    loadingElement.classList.add('hidden');
  }
}

// Fetch route from OpenRouteService
async function fetchRoute(startCoords, endCoords, startAddress, endAddress) {
  const avoidHighways = document.getElementById('avoid-highways').checked;
  const avoidTolls = document.getElementById('avoid-tolls').checked;
  const loadingElement = document.getElementById('loading');

  try {
    // Set route options
    const routeOptions = {
      coordinates: [startCoords, endCoords],
      profile: 'driving-car',
      preference: avoidHighways ? 'shortest' : 'recommended',
      instructions: true,
      format: 'geojson'
    };

    const avoidFeatures = [];
    if (avoidHighways) avoidFeatures.push('highways');
    if (avoidTolls) avoidFeatures.push('tollways');

    if (avoidFeatures.length > 0) {
      routeOptions.options = {
        avoid_features: avoidFeatures
      };
    }

    console.log('Fetching route with options:', routeOptions);

    // Get route from OpenRouteService
    const routeResponse = await orsDirections.calculate(routeOptions);

    if (routeResponse.features && routeResponse.features[0]) {
      const numPoints = routeResponse.features[0].geometry.coordinates.length;
      console.log(`Route has ${numPoints} points along the path`);

      if (numPoints < 3) {
        console.warn('Route has very few points - might be a straight line');
      }
    }

    // Display the route
    displayRoute(routeResponse, startCoords, endCoords, startAddress, endAddress);

  } catch (error) {
    // AbortError means the user cancelled or re-submitted — not a real error
    if (error.name === 'AbortError') {
      console.log('Route request was aborted (user re-submitted).');
      loadingElement.classList.add('hidden');
      return;
    }
    console.error('Error fetching route:', error);
    if (error.message && error.message.includes('distance')) {
      alert('The locations are too far apart. Please try locations that are closer together.');
    } else {
      alert('Failed to calculate route. Please check your inputs and try again.');
    }
    loadingElement.classList.add('hidden');
  }
}

// Display route on map
function displayRoute(routeData, startCoords, endCoords, startAddress, endAddress) {
  // Update route source
  map.getSource('route').setData(routeData);

  // Get route summary for display
  const properties = routeData.features[0].properties;
  const distance = properties.summary.distance;
  const duration = properties.summary.duration;

  // Store in window object for chatbot access
  window.currentDistance = distance;
  window.currentDuration = duration;
  window.currentStartAddress = startAddress;
  window.currentEndAddress = endAddress;
  window.currentRoute = routeData;

  // Update trip summary
  updateTripSummary({
    distance,
    duration,
    startAddress,
    endAddress
  });

  // Calculate trip costs
  calculateTripCosts(distance, duration, startAddress, endAddress);

  // Update distance overlay
  updateDistanceOverlay(distance);

  // Add markers for start and end points
  addCustomMarker(startCoords, 'start', startAddress);
  addCustomMarker(endCoords, 'end', endAddress);

  // Find places along the route (gas stations, attractions, restaurants, hotels)
  const routeCoords = routeData.features[0].geometry.coordinates;
  findPlacesAlongRoute(routeCoords);

  // Show summary section
  document.getElementById('summary').classList.remove('hidden');

  // Hide loading indicator
  document.getElementById('loading').classList.add('hidden');

  // Fit map to show entire route
  const bounds = new mapboxgl.LngLatBounds();
  routeCoords.forEach(coord => bounds.extend(coord));
  lastRouteCoords = routeCoords; // Store for POI toggles
  map.fitBounds(bounds, { padding: 50 });
}

// Find places along the route (initial load — all 4 categories)
async function findPlacesAlongRoute(routeCoords) {
  const numPoints = routeCoords.length;

  if (numPoints < 4) {
    console.warn('Not enough route points to find places along route');
    return;
  }

  try {
    const searchPoints = getSearchPoints(routeCoords);

    // Fetch all types of POIs
    const poiTypes = ['fuel', 'attraction', 'restaurant', 'hotel'];

    for (const poiType of poiTypes) {
      const allPlaces = [];

      for (const point of searchPoints) {
        try {
          const places = await fetchPOIs(poiType, point);
          if (Array.isArray(places)) allPlaces.push(...places);
        } catch (err) {
          console.error(`Error fetching ${poiType} POIs at point:`, err);
        }
        await sleep(300);
      }

      // Map API type to display type
      const displayType = poiType === 'fuel' ? 'gas' : poiType;

      // Remove duplicates and limit to 5 results
      const uniquePlaces = removeDuplicatePlaces(allPlaces);
      const placesToShow = uniquePlaces.slice(0, 5);

      // Add markers and update lists
      placesToShow.forEach(place => addPlaceMarker(place, displayType));
      updatePlacesList(placesToShow, displayType);
    }

  } catch (error) {
    console.error('Error finding places along route:', error);
  }
}

// Add custom marker for start and end points
function addCustomMarker(coords, type, title) {
  const el = document.createElement('div');
  el.className = type === 'start' ? 'marker-start' : 'marker-end';

  const popup = new mapboxgl.Popup({ offset: 25 })
    .setHTML(`
      <div>
        <h3 class="font-bold">${type === 'start' ? 'Starting Point' : 'Destination'}</h3>
        <p>${title}</p>
      </div>
    `);

  const marker = new mapboxgl.Marker(el)
    .setLngLat(coords)
    .setPopup(popup)
    .addTo(map);

  if (type === 'start') {
    startMarker = marker;
  } else {
    endMarker = marker;
  }

  markers.push(marker);
  return marker;
}

// Add a marker for a place found along the route
function addPlaceMarker(place, type) {
  const coordinates = place.geometry ? place.geometry.coordinates : place.coordinates;
  const name = place.properties?.name || place.name || 'Unnamed Place';
  const placeId = (place.properties?.osm_id || place.id || Math.random().toString(36).substr(2, 9)).toString();

  const el = document.createElement('div');
  el.className = `marker-${type}`;

  const popupContent = `
    <div>
      <h3 class="font-bold text-lg">${name}</h3>
      <p class="text-sm text-gray-500">${type.charAt(0).toUpperCase() + type.slice(1)}</p>
      ${type === 'attraction' ? `
        <button class="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition"
                onclick="fetchImagesByPlace('${name.replace(/'/g, "\\'")}')">
          View Photos
        </button>
      ` : ''}
    </div>
  `;

  const popup = new mapboxgl.Popup({ offset: 25 })
    .setHTML(popupContent);

  const marker = new mapboxgl.Marker(el)
    .setLngLat(coordinates)
    .setPopup(popup)
    .addTo(map);

  poiMarkers.push({
    marker: marker,
    type: type,
    id: placeId
  });

  return marker;
}

// Update trip summary
function updateTripSummary(data) {
  const distance = (data.distance / 1000).toFixed(1) + ' km';
  const duration = (data.duration / 3600).toFixed(1) + ' hrs';

  document.getElementById('route-details').innerHTML = `
    <p><strong>Distance:</strong> ${distance}</p>
    <p><strong>Duration:</strong> ${duration}</p>
    <p><strong>Start:</strong> ${data.startAddress}</p>
    <p><strong>End:</strong> ${data.endAddress}</p>
  `;
}

// Update places list in the summary
function updatePlacesList(places, type) {
  console.log(`Updating ${type} places list with:`, places);

  let containerId;
  if (type === 'gas') containerId = 'gas-stations-list';
  else if (type === 'attraction') containerId = 'attractions-list';
  else if (type === 'restaurant') containerId = 'restaurants-list';
  else if (type === 'hotel') containerId = 'hotels-list';

  const container = document.getElementById(containerId);

  if (!container) {
    console.warn(`Container for ${type} not found in DOM`);
    return;
  }

  container.innerHTML = '';

  if (!places || places.length === 0) {
    container.innerHTML = `<p class="text-gray-400">No ${type}s found along this route.</p>`;
    return;
  }

  const normalizedPlaces = places.map(place => ({
    id: (place.properties?.osm_id || place.id || Math.random().toString(36).substr(2, 9)).toString(),
    name: place.properties?.name || place.name || 'Unnamed Place',
    distance: place.properties?.distance || place.distance || 0,
    coordinates: place.geometry?.coordinates || place.coordinates || [0, 0]
  }));

  // Store in window object for chatbot access
  if (type === 'gas') window.gasStationsList = normalizedPlaces;
  else if (type === 'attraction') window.attractionsList = normalizedPlaces;
  else if (type === 'restaurant') window.restaurantsList = normalizedPlaces;
  else if (type === 'hotel') window.hotelsList = normalizedPlaces;

  normalizedPlaces.forEach(place => {
    const placeElement = document.createElement('div');
    placeElement.classList.add('mb-2', 'pb-2', 'border-b', 'border-gray-600');

    const nameElement = document.createElement('div');
    nameElement.classList.add('font-medium', 'cursor-pointer', 'hover:text-green-400');
    nameElement.textContent = place.name;

    nameElement.addEventListener('click', () => {
      const markerObj = poiMarkers.find(m => m.type === type && m.id === place.id);
      if (markerObj) {
        map.flyTo({ center: markerObj.marker.getLngLat(), zoom: 15, speed: 1.5 });
        const el = markerObj.marker.getElement();
        el.classList.add('bounce-animation');
        setTimeout(() => el.classList.remove('bounce-animation'), 600);
        if (type === 'attraction') fetchImagesByPlace(place.name);
      } else if (place.coordinates && place.coordinates.length === 2) {
        map.flyTo({ center: place.coordinates, zoom: 15, speed: 1.5 });
        if (type === 'attraction') fetchImagesByPlace(place.name);
      }
    });

    placeElement.appendChild(nameElement);

    if (place.distance && place.distance > 0) {
      const distanceElement = document.createElement('div');
      distanceElement.classList.add('text-xs', 'text-gray-400');
      distanceElement.textContent = `${(place.distance / 1000).toFixed(1)} km from route`;
      placeElement.appendChild(distanceElement);
    }

    container.appendChild(placeElement);
  });
}

// Calculate trip costs — calls backend /api/costs which securely uses Groq
async function calculateTripCosts(distance, duration, startAddress, endAddress) {
  try {
    const distanceKm = distance / 1000;
    const durationHours = duration / 3600;

    // --- Default fallback values (shown immediately) ---
    const fuelCostUSD = (distanceKm / 100) * 8.0 * 1.5;
    document.getElementById('fuel-cost').textContent = `$${fuelCostUSD.toFixed(2)}`;
    document.getElementById('travel-time').textContent =
      `${Math.floor(durationHours)} hours ${Math.floor((durationHours % 1) * 60)} minutes`;
    document.getElementById('rest-stops').textContent = Math.ceil(durationHours / 3);
    document.getElementById('toll-cost').textContent = 'No data available';

    // --- Show "Calculating..." while waiting for AI ---
    const costElements = ['fuel-cost', 'rest-stops', 'toll-cost'];
    costElements.forEach(id => {
      const el = document.getElementById(id);
      el.dataset.originalText = el.textContent;
      el.textContent = 'Calculating...';
      el.classList.add('cost-loading');
    });

    // --- Call secure backend endpoint ---
    const response = await fetch('/api/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distanceKm, durationHours, startAddress, endAddress })
    });

    const tripData = await response.json();

    // Restore and update with AI values
    costElements.forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('cost-loading');
      el.textContent = el.dataset.originalText;
    });

    if (tripData.fuelCost) document.getElementById('fuel-cost').textContent = tripData.fuelCost;
    if (tripData.restStops) document.getElementById('rest-stops').textContent = tripData.restStops;
    if (tripData.tollCost) document.getElementById('toll-cost').textContent = tripData.tollCost;

    if (!tripData.error) {
      costElements.forEach(id => {
        const el = document.getElementById(id);
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
      });
    }

  } catch (error) {
    console.error('Error calculating trip costs:', error);
    ['fuel-cost', 'rest-stops', 'toll-cost'].forEach(id => {
      const el = document.getElementById(id);
      if (el.classList.contains('cost-loading')) {
        el.classList.remove('cost-loading');
        el.textContent = el.dataset.originalText || 'N/A';
      }
    });
  }
}

// Update distance overlay
function updateDistanceOverlay(distance) {
  currentDistance = distance;
  const distanceKm = (distance / 1000).toFixed(1);
  const distanceMiles = (distanceKm * 0.621371).toFixed(1);

  const overlay = document.getElementById('distance-overlay');
  overlay.textContent = `Distance: ${distanceKm} km (${distanceMiles} mi)`;

  setTimeout(() => {
    overlay.classList.add('active');
  }, 300);
}

// Fetch images for a specific place name
function fetchImagesByPlace(placeName) {
  galleryImages = [];
  currentGalleryIndex = 0;

  const galleryTitle = document.getElementById('gallery-title');
  galleryTitle.textContent = `Loading images for: ${placeName}...`;
  document.getElementById('image-gallery').classList.add('active');

  fetchUnsplashImages(placeName);
}

// Fetch images from Unsplash
function fetchUnsplashImages(placeName) {
  console.log("Fetching Unsplash images for:", placeName);
  const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(placeName)}&per_page=10&client_id=${window.UNSPLASH_ACCESS_KEY}`;

  fetch(unsplashUrl)
    .then(response => {
      if (!response.ok) {
        console.error('Unsplash API error:', response.status);
        throw new Error('Failed to fetch images from Unsplash');
      }
      return response.json();
    })
    .then(data => {
      console.log("Unsplash API response:", data);
      if (data.results && data.results.length > 0) {
        galleryImages = data.results.map(photo => ({
          url: photo.urls.regular,
          title: photo.description || photo.alt_description || placeName
        }));

        showImage(0);
        document.getElementById('gallery-title').textContent = placeName;
      } else {
        console.log("No Unsplash results, falling back to Flickr");
        fetchFlickrImages(placeName);
      }
    })
    .catch(err => {
      console.error('Error fetching Unsplash images:', err);
      fetchFlickrImages(placeName);
    });
}

// Fetch images from Flickr (fallback)
function fetchFlickrImages(placeName) {
  const apiKey = 'your main api key';
  const flickrUrl = `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${apiKey}&text=${encodeURIComponent(placeName)}&format=json&nojsoncallback=1&per_page=10&sort=relevance`;

  fetch(flickrUrl)
    .then(response => {
      if (!response.ok) throw new Error('Failed to fetch images from Flickr');
      return response.json();
    })
    .then(data => {
      if (data.photos && data.photos.photo && data.photos.photo.length > 0) {
        galleryImages = data.photos.photo.map(photo => ({
          url: `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`,
          title: photo.title || placeName
        }));

        showImage(0);
        document.getElementById('gallery-title').textContent = placeName;
      } else {
        const simplifiedName = placeName.split(' ')[0];
        if (simplifiedName !== placeName) {
          fetchFlickrImages(simplifiedName);
        } else {
          document.getElementById('gallery-image').src = '';
          document.getElementById('gallery-title').textContent = `No images found for "${placeName}"`;
        }
      }
    })
    .catch(err => {
      console.error('Error fetching Flickr images:', err);
      document.getElementById('gallery-image').src = '';
      document.getElementById('gallery-title').textContent = 'Error loading images';
    });
}

// Show image at specific index
function showImage(index) {
  if (galleryImages.length === 0) return;

  currentGalleryIndex = (index + galleryImages.length) % galleryImages.length;

  const imgElement = document.getElementById('gallery-image');

  imgElement.style.opacity = '0';
  imgElement.style.transform = 'scale(0.9)';

  setTimeout(() => {
    imgElement.src = galleryImages[currentGalleryIndex].url;
    document.getElementById('gallery-title').textContent = galleryImages[currentGalleryIndex].title;
    imgElement.style.opacity = '1';
    imgElement.style.transform = 'scale(1)';
  }, 300);
}

// Show next image
function showNextImage() {
  showImage(currentGalleryIndex + 1);
}

// Show previous image
function showPrevImage() {
  showImage(currentGalleryIndex - 1);
}

// Close gallery
function closeGallery() {
  document.getElementById('image-gallery').classList.remove('active');
}

// Clear all markers
function clearMarkers() {
  markers.forEach(marker => marker.remove());
  markers = [];

  if (startMarker) startMarker.remove();
  if (endMarker) endMarker.remove();
  startMarker = null;
  endMarker = null;

  if (map.getSource('route')) {
    map.getSource('route').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: []
      }
    });
  }

  document.getElementById('distance-overlay').classList.remove('active');
}

// Add keyboard controls for gallery
document.addEventListener('keydown', (e) => {
  if (document.getElementById('image-gallery').classList.contains('active')) {
    if (e.key === 'Escape') closeGallery();
    if (e.key === 'ArrowRight') showNextImage();
    if (e.key === 'ArrowLeft') showPrevImage();
  }
});

// Initialize the map when the page loads
document.addEventListener('DOMContentLoaded', initMap);

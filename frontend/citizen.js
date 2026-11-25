
(function () {
    "use strict";

    const API = "/api";

    // Default map location: Tiruvannamalai
    const DEFAULT_LAT = 12.2253;
    const DEFAULT_LNG = 79.0747;

    let leafletMap = null;
    let locationMarker = null;
    let roadSearchRequest = 0;

    // ==========================================
    // NOTIFICATIONS
    // ==========================================

    function showNotification(message, type = "success") {

        const notification = document.getElementById("notification");

        if (notification) {
            notification.textContent = message;
            notification.className = `notification ${type}`;
            notification.style.display = "block";

            setTimeout(() => {
                notification.style.display = "none";
            }, 4000);

        } else {
            alert(message);
        }
    }

    // ==========================================
    // HTML SAFETY
    // ==========================================

    function escapeHTML(value) {

        return String(value ?? "Not available")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ==========================================
    // GET ROAD NAME FROM COORDINATES
    // ==========================================

    async function getRoadNameFromLocation(lat, lng) {

        try {

            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
            );

            if (!response.ok) {
                throw new Error("Address lookup failed");
            }

            const data = await response.json();

            return data.display_name || "Selected location";

        } catch (error) {

            console.error("Reverse geocoding error:", error);

            return "Selected location";
        }
    }

    // ==========================================
    // SET SELECTED LOCATION
    // ==========================================

    async function setLocation(lat, lng, address = null) {

        const latitudeInput =
            document.getElementById("lat");

        const longitudeInput =
            document.getElementById("lng");

        const pickedAddress =
            document.getElementById("pickedAddress");

        const roadNameInput =
            document.getElementById("road_name");

        if (latitudeInput) {
            latitudeInput.value = lat;
        }

        if (longitudeInput) {
            longitudeInput.value = lng;
        }

        if (leafletMap) {

            leafletMap.setView(
                [lat, lng],
                17
            );

            if (!locationMarker) {

                locationMarker = L.marker(
                    [lat, lng]
                ).addTo(leafletMap);

            } else {

                locationMarker.setLatLng(
                    [lat, lng]
                );
            }
        }

        let finalAddress = address;

        if (!finalAddress) {
            finalAddress = await getRoadNameFromLocation(lat, lng);
        }

        if (pickedAddress) {
            pickedAddress.textContent = finalAddress;
        }

        if (roadNameInput) {
            roadNameInput.value = finalAddress;
        }

        console.log(
            "Selected location:",
            lat,
            lng,
            finalAddress
        );
    }

    // ==========================================
    // INITIALIZE LEAFLET MAP
    // ==========================================

    function initMap() {

        const mapElement =
            document.getElementById("pickMap");

        if (!mapElement || typeof L === "undefined") {
            console.error("Map element or Leaflet is missing.");
            return;
        }

        leafletMap = L.map("pickMap").setView(
            [DEFAULT_LAT, DEFAULT_LNG],
            13
        );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution: "&copy; OpenStreetMap contributors",
                maxZoom: 19
            }
        ).addTo(leafletMap);

        leafletMap.on("click", function (event) {

            setLocation(
                event.latlng.lat,
                event.latlng.lng
            );
        });



        setTimeout(() => {
            leafletMap.invalidateSize();
        }, 300);
    }

    // ==========================================
    // CURRENT LOCATION BUTTON
    // ==========================================

    function getCurrentLocation() {

        if (!navigator.geolocation) {

            showNotification(
                "Your browser does not support location services.",
                "error"
            );

            return;
        }

        showNotification(
            "Getting your current location...",
            "success"
        );

        navigator.geolocation.getCurrentPosition(

            async function (position) {

                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                await setLocation(lat, lng);

                showNotification(
                    "Your current location has been selected.",
                    "success"
                );
            },

            function (error) {

                console.error("GPS error:", error);

                let message = "Unable to get your current location.";

                if (error.code === 1) {

                    message =
                        "Location permission denied. Allow location access in your browser settings.";

                } else if (error.code === 2) {

                    message =
                        "Your current location is unavailable. Please check your device location settings.";

                } else if (error.code === 3) {

                    message =
                        "Location request timed out. Please try again.";
                }

                showNotification(message, "error");
            },

            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    }

    // ==========================================
    // SEARCH FOR A ROAD OR PLACE
    // ==========================================

    async function searchPlace() {

        const searchInput =
            document.getElementById("placeSearch");

        if (!searchInput) return;

        const searchText = searchInput.value.trim();

        if (!searchText) {

            showNotification(
                "Please enter a road or place name.",
                "error"
            );

            return;
        }

        const requestId = ++roadSearchRequest;

        showNotification(
            "Searching for location...",
            "success"
        );

        try {

            const query =
                `${searchText}, Tamil Nadu, India`;

            const url =
                "https://nominatim.openstreetmap.org/search?" +
                new URLSearchParams({
                    format: "jsonv2",
                    q: query,
                    limit: "5"
                });

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error("Location search failed");
            }

            const results = await response.json();

            if (requestId !== roadSearchRequest) return;

            if (!results.length) {

                showNotification(
                    "Location not found. Try another place name.",
                    "error"
                );

                return;
            }

            const result = results[0];

            await setLocation(
                parseFloat(result.lat),
                parseFloat(result.lon),
                result.display_name
            );

            showNotification(
                "Location found successfully.",
                "success"
            );

        } catch (error) {

            console.error("Place search error:", error);

            showNotification(
                "Unable to search for this location. Please try again.",
                "error"
            );
        }
    }

    // ==========================================
    // SUBMIT ROAD DAMAGE REPORT
    // ==========================================

    async function submitReport(event) {

        event.preventDefault();

        const form =
            document.getElementById("reportForm");

        if (!form) return;

        const photoInput =
            form.querySelector('input[name="photo"]');

        const latitudeInput =
            document.getElementById("lat");

        const longitudeInput =
            document.getElementById("lng");

        const roadNameInput =
            document.getElementById("road_name");

        if (!photoInput || !photoInput.files.length) {

            showNotification(
                "Please upload a pothole photograph.",
                "error"
            );

            return;
        }

        if (
            !latitudeInput ||
            !longitudeInput ||
            latitudeInput.value === "" ||
            longitudeInput.value === ""
        ) {

            showNotification(
                "Please select the correct road location on the map.",
                "error"
            );

            return;
        }

        if (
            !roadNameInput ||
            !roadNameInput.value.trim()
        ) {

            showNotification(
                "Please enter the road name.",
                "error"
            );

            return;
        }

        const submitButton =
            form.querySelector('[type="submit"]');

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Submitting...";
        }

        try {

            const formData = new FormData(form);

            formData.set(
                "lat",
                latitudeInput.value
            );

            formData.set(
                "lng",
                longitudeInput.value
            );

            const response = await fetch(
                `${API}/reports`,
                {
                    method: "POST",
                    body: formData
                }
            );

            const data = await response.json();

            if (!response.ok || !data.accepted) {

                showNotification(
                    data.message || "Report could not be submitted.",
                    "error"
                );

                return;
            }

            const ticket = data.ticket;

            const ticketCode =
                ticket?.ticket_code || "Not available";

            showNotification(
                `Complaint submitted successfully! Ticket number: ${ticketCode}`,
                "success"
            );

            form.reset();

            if (ticket) {

                const latitude = ticket.lat;
                const longitude = ticket.lng;

                if (
                    latitude !== undefined &&
                    longitude !== undefined
                ) {

                    await setLocation(
                        latitude,
                        longitude,
                        ticket.road_name
                    );
                }
            }

            console.log("Submitted ticket:", ticket);

        } catch (error) {

            console.error("Report submission error:", error);

            showNotification(
                "Unable to submit your complaint. Check your server and try again.",
                "error"
            );

        } finally {

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Submit Complaint";
            }
        }
    }

    // ==========================================
    // DISPLAY FULL TICKET DETAILS
    // ==========================================

    function displayTicketDetails(data, output) {

        const reportedDate = data.first_reported
            ? new Date(data.first_reported).toLocaleString()
            : "Not available";

        const photoSection = data.photo_url
            ? `
                <div class="citizen-ticket-photo">
                    <h3>Your Uploaded Pothole Photograph</h3>

                    <img
                        src="${escapeHTML(data.photo_url)}"
                        alt="Original photograph uploaded by you"
                        onerror="
                            this.style.display='none';
                            this.nextElementSibling.style.display='block';
                        "
                    >

                    <p style="display:none;">
                        Original photograph is unavailable.
                    </p>
                </div>
            `
            : `
                <p>Original photograph is unavailable.</p>
            `;

        output.innerHTML = `
            <div class="citizen-ticket-details">

                <h3>Complaint Details</h3>

                <p>
                    <strong>Ticket Number:</strong>
                    ${escapeHTML(data.ticket_code)}
                </p>

                <p>
                    <strong>Current Status:</strong>
                    <span class="citizen-ticket-status">
                        ${escapeHTML(data.status)}
                    </span>
                </p>

                <p>
                    <strong>Road / Location:</strong>
                    ${escapeHTML(data.road_name)}
                </p>

                <p>
                    <strong>Damage Type:</strong>
                    ${escapeHTML(data.damage_type)}
                </p>

                <p>
                    <strong>Severity:</strong>
                    ${escapeHTML(data.severity)}
                </p>

                <p>
                    <strong>Complaint Date:</strong>
                    ${escapeHTML(reportedDate)}
                </p>

                <p>
                    <strong>Latitude:</strong>
                    ${escapeHTML(data.lat)}
                </p>

                <p>
                    <strong>Longitude:</strong>
                    ${escapeHTML(data.lng)}
                </p>

                <p>
                    <strong>Total Reports:</strong>
                    ${escapeHTML(data.report_count)}
                </p>

                <p>
                    <strong>AI Confidence:</strong>
                    ${escapeHTML(data.ai_confidence)}%
                </p>

                <p>
                    <strong>Damage Area:</strong>
                    ${escapeHTML(data.damage_area_pct)}%
                </p>

                ${photoSection}

                <a
                    class="citizen-download-pdf"
                    href="${escapeHTML(data.pdf_url)}"
                    download
                >
                    Download Complaint PDF
                </a>

            </div>
        `;
    }

    // ==========================================
    // CHECK TICKET STATUS
    // ==========================================

    async function lookupTicket() {

        const codeInput =
            document.getElementById("lookupCode");

        const output =
            document.getElementById("lookupResult");

        if (!codeInput || !output) return;

        const code = codeInput.value.trim().toUpperCase();

        if (!code) {

            output.textContent =
                "Please enter your ticket number.";

            return;
        }

        output.textContent = "Checking ticket...";

        try {

            const response = await fetch(
                `${API}/lookup/${encodeURIComponent(code)}`
            );

            const data = await response.json();

            if (!response.ok) {

                output.textContent =
                    data.error || "Ticket not found.";

                return;
            }

            displayTicketDetails(data, output);

        } catch (error) {

            console.error("Ticket lookup error:", error);

            output.textContent =
                "Unable to check ticket status. Please try again.";
        }
    }

    // ==========================================
    // INITIALIZE ALL EVENTS
    // ==========================================

    document.addEventListener("DOMContentLoaded", function () {

        // Initialize map
        initMap();

        // Current location button
        const locationButton =
            document.getElementById("myLocationBtn");

        if (locationButton) {

            locationButton.addEventListener(
                "click",
                getCurrentLocation
            );
        }

        // Search button
        const searchButton =
            document.getElementById("placeSearchBtn");

        if (searchButton) {

            searchButton.addEventListener(
                "click",
                searchPlace
            );
        }

        // Press Enter to search
        const searchInput =
            document.getElementById("placeSearch");

        if (searchInput) {

            searchInput.addEventListener(
                "keydown",
                function (event) {

                    if (event.key === "Enter") {

                        event.preventDefault();
                        searchPlace();
                    }
                }
            );
        }

        // Submit complaint
        const reportForm =
            document.getElementById("reportForm");

        if (reportForm) {

            reportForm.addEventListener(
                "submit",
                submitReport
            );
        }

        // Check ticket status
        const lookupButton =
            document.getElementById("lookupBtn");

        if (lookupButton) {

            lookupButton.addEventListener(
                "click",
                lookupTicket
            );
        }

        // Enter ticket code using keyboard
        const lookupInput =
            document.getElementById("lookupCode");

        if (lookupInput) {

            lookupInput.addEventListener(
                "keydown",
                function (event) {

                    if (event.key === "Enter") {

                        event.preventDefault();
                        lookupTicket();
                    }
                }
            );
        }

    });

})();

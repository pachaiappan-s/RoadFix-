
(function () {
    "use strict";

    const API = "/api";
    const STATUSES = ["Reported", "Verified", "Assigned", "Fixed"];

    let allTickets = [];
    let currentTicketId = null;
    let selectedStatus = "Reported";
    let leafletMap = null;
    let markersLayer = null;

    let rfCalendarLineChart = null;
    let rfCalendarPieChart = null;
    let rfCalendarData = null;
    let rfCalendarSelectedDate = null;

    const $ = id => document.getElementById(id);

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function ticketId(ticket) {
        return ticket.id ?? ticket.ticket_id;
    }

    function ticketCode(ticket) {
        return ticket.ticket_code || ("RF-" + ticketId(ticket));
    }

    function priority(ticket) {
        return Number(ticket.priority ?? 0);
    }

    function statusClass(status) {
        return String(status || "Reported")
            .toLowerCase()
            .replace(/\s+/g, "-");
    }

    function statusBadge(status) {
        return `<span class="rf-badge ${statusClass(status)}">
            ${escapeHTML(status || "Reported")}
        </span>`;
    }

    function showMessage(message) {
        alert(message);
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.headers || {})
            }
        });

        if (response.status === 401 || response.status === 403) {
            window.location.href = "/login";
            throw new Error("Please log in again.");
        }

        if (!response.ok) {
            let message = "Request failed.";

            try {
                const data = await response.json();
                message = data.error || data.message || message;
            } catch (_) {}

            throw new Error(message);
        }

        return response;
    }

    // ------------------------------------------
    // SIDEBAR NAVIGATION
    // ------------------------------------------

    function openView(viewId) {
        document.querySelectorAll(".rf-view").forEach(view => {
            view.classList.toggle("active", view.id === viewId);
        });

        document.querySelectorAll(".rf-nav-item").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.view === viewId
            );
        });

        const activeButton = document.querySelector(
            `.rf-nav-item[data-view="${viewId}"]`
        );

        if (activeButton) {
            $("rfPageTitle").textContent =
                activeButton.textContent.trim();
        }

        const subtitles = {
            overview: "Road damage monitoring and maintenance intelligence",
            "map-section": "Geographical road damage monitoring",
            complaints: "Review and manage road damage complaints",
            "ai-detection": "YOLO26 computer vision results",
            "status-tracking": "Monitor complaint repair progress",
            "work-orders": "Maintenance work order documentation",
            "monthly-reports": "Monthly complaint statistics and repair progress"
        };

        $("rfPageSubtitle").textContent =
            subtitles[viewId] || "";

        if (viewId === "map-section") {
            setTimeout(() => {
                if (leafletMap) leafletMap.invalidateSize();
            }, 150);
        }

        if (viewId === "monthly-reports") {
            loadMonthlyCalendar();
        }
    }

    document.querySelectorAll(".rf-nav-item").forEach(button => {
        button.addEventListener("click", () => {
            openView(button.dataset.view);
        });
    });

    document.querySelectorAll("[data-open-view]").forEach(button => {
        button.addEventListener("click", () => {
            openView(button.dataset.openView);
        });
    });

    // ------------------------------------------
    // LOAD STATISTICS
    // ------------------------------------------

    async function loadStats() {
        try {
            const response = await apiRequest(`${API}/stats`);
            const stats = await response.json();

            $("rfTotal").textContent =
                stats.total_tickets ?? 0;

            $("rfOpen").textContent =
                stats.open_tickets ?? 0;

            $("rfDuplicates").textContent =
                (stats.duplicates_merged_pct ?? 0) + "%";

            $("rfRepairTime").textContent =
                (stats.avg_repair_days ?? 0) + " days";

            $("rfRejected").textContent =
                (stats.rejected_pct ?? 0) + "%";

            const pipeline = stats.pipeline || {};

            $("pipeline").innerHTML = STATUSES.map(status => `
                <button class="rf-pipeline-item"
                        data-pipeline-status="${status}">
                    <span>${status}</span>
                    <strong>${pipeline[status] ?? 0}</strong>
                    <small>View complaints →</small>
                </button>
            `).join("");

            STATUSES.forEach(status => {
                const element = $("count" + status);

                if (element) {
                    element.textContent = pipeline[status] ?? 0;
                }
            });

            document.querySelectorAll("[data-pipeline-status]")
                .forEach(button => {
                    button.addEventListener("click", () => {
                        selectStatus(button.dataset.pipelineStatus);
                        openView("status-tracking");
                    });
                });

        } catch (error) {
            console.error("Statistics error:", error);
        }
    }

    // ------------------------------------------
    // MONTHLY REPORTS CALENDAR
    // ------------------------------------------

    function setCurrentCalendarMonth() {
        const monthInput = $("rfCalendarMonth");

        if (!monthInput) {
            console.error("Calendar month input not found.");
            return;
        }

        const now = new Date();

        monthInput.value =
            now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0");
    }

    async function loadMonthlyCalendar() {
        const monthInput = $("rfCalendarMonth");
        const calendarGrid = $("rfCalendarGrid");

        if (!monthInput || !calendarGrid) {
            console.error("Monthly calendar HTML elements are missing.");
            return;
        }

        const month = monthInput.value;

        if (!month) return;

        calendarGrid.innerHTML =
            "<p>Loading monthly reports...</p>";

        try {
            const response = await apiRequest(
                `${API}/calendar?month=${encodeURIComponent(month)}`
            );

            const data = await response.json();

            rfCalendarData = data;

            $("rfCalendarTotal").textContent =
                data.total_reports ?? 0;

            $("rfCalendarAccepted").textContent =
                data.accepted_reports ?? 0;

            $("rfCalendarCompleted").textContent =
                data.completed ?? 0;

            $("rfCalendarIncomplete").textContent =
                data.incomplete ?? 0;

            $("rfCalendarRejected").textContent =
                data.rejected_reports ?? 0;

            const [year, monthNumber] = data.month.split("-").map(Number);

            $("rfCalendarHeading").textContent =
                new Date(year, monthNumber - 1, 1)
                    .toLocaleDateString("en-IN", {
                        month: "long",
                        year: "numeric"
                    });

            renderMonthlyCalendar(data);
            renderMonthlyChart(data);

        } catch (error) {
            console.error("Monthly calendar error:", error);

            calendarGrid.innerHTML =
                `<p>Could not load calendar: ${escapeHTML(error.message)}</p>`;
        }
    }

    function renderMonthlyCalendar(data) {
        const [year, month] = data.month.split("-").map(Number);

        const firstDay =
            new Date(year, month - 1, 1).getDay();

        const daysInMonth =
            new Date(year, month, 0).getDate();

        const dayData = {};

        (data.days || []).forEach(day => {
            dayData[day.date] = day;
        });

        let html = "";

        for (let i = 0; i < firstDay; i++) {
            html += `<div class="rf-calendar-empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey =
                `${data.month}-${String(day).padStart(2, "0")}`;

            const item = dayData[dateKey] || {
                reports: 0,
                tickets: []
            };

            const tickets = item.tickets || [];

            const completed = tickets.filter(
                ticket => ticket.status === "Fixed"
            ).length;

            const incomplete = tickets.length - completed;

            const selected =
                rfCalendarSelectedDate === dateKey;

            html += `
                <button
                    type="button"
                    class="rf-calendar-day ${selected ? "selected" : ""}"
                    data-calendar-date="${dateKey}"
                >
                    <strong>${day}</strong>

                    <span class="rf-calendar-report-count">
                        ${item.reports || 0} reports
                    </span>

                    <span class="rf-calendar-day-status">
                        <i class="rf-calendar-dot completed"></i>
                        ${completed} done
                    </span>

                    <span class="rf-calendar-day-status">
                        <i class="rf-calendar-dot incomplete"></i>
                        ${incomplete} pending
                    </span>
                </button>
            `;
        }

        $("rfCalendarGrid").innerHTML = html;

        // Clear selection if it does not belong to this month.
        if (
            rfCalendarSelectedDate &&
            !dayData[rfCalendarSelectedDate]
        ) {
            rfCalendarSelectedDate = null;
        }

        document.querySelectorAll("[data-calendar-date]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    rfCalendarSelectedDate =
                        button.dataset.calendarDate;

                    renderMonthlyCalendar(rfCalendarData);

                    showCalendarDayDetails(
                        rfCalendarSelectedDate
                    );
                });
            });

        if (!rfCalendarSelectedDate) {
            $("rfCalendarDetails").innerHTML =
                "<p>Select a date in the calendar to view complaints.</p>";

            $("rfCalendarDetailHeading").textContent =
                "Daily Complaint Details";
        }
    }

    // ------------------------------------------
    // LINE CHART + PIE CHART
    // ------------------------------------------

    function renderMonthlyChart(data) {
        if (!window.Chart) {
            console.error("Chart.js is not loaded.");
            return;
        }

        const chartContainer =
            document.querySelector(".rf-calendar-chart");

        if (!chartContainer) {
            console.error("Chart container not found.");
            return;
        }

        // Destroy old charts before drawing updated charts.
        if (rfCalendarLineChart) {
            rfCalendarLineChart.destroy();
            rfCalendarLineChart = null;
        }

        if (rfCalendarPieChart) {
            rfCalendarPieChart.destroy();
            rfCalendarPieChart = null;
        }

        // Create two chart areas inside the existing HTML container.
        chartContainer.innerHTML = `
            <div style="width:100%; margin-bottom:25px;">
                <h4 style="margin:10px 0 15px;">
                    Daily Complaint Status — Line Chart
                </h4>
                <div style="position:relative; width:100%; height:280px;">
                    <canvas id="rfCalendarLineChart"></canvas>
                </div>
            </div>

            <div style="width:100%; margin-top:20px;">
                <h4 style="margin:10px 0 15px;">

                </h4>
                <div style="position:relative; width:100%; height:300px;">
                    <canvas id="rfCalendarPieChart"></canvas>
                </div>
            </div>
        `;

        // --------------------------------------
        // DAILY LINE CHART
        // --------------------------------------

        const days = data.days || [];

        const dayLabels = days.map(day => {
            return Number(day.date.split("-")[2]);
        });

        const dailyReports = days.map(day => {
            return Number(day.reports || 0);
        });

        const lineCanvas = $("rfCalendarLineChart");

        rfCalendarLineChart = new Chart(lineCanvas, {
            type: "line",

            data: {
                labels: dayLabels,

                datasets: [{
                    label: "Daily Reports",
                    data: dailyReports,
                    borderColor: "#e9a23b",
                    backgroundColor: "#e9a23b",
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.25,
                    fill: false
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                // IMPORTANT:
                // This hides the four status labels from the line chart.
                plugins: {
                    legend: {
                        display: false
                    },

                    title: {
                        display: true,
                        text: "Daily Complaint Status"
                    }
                },

                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Day of Month"
                        }
                    },

                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        },
                        title: {
                            display: true,
                            text: "Number of Complaints"
                        }
                    }
                }
            }
        });

        // --------------------------------------
        // MONTHLY PIE CHART
        // --------------------------------------

        const statusCounts = {
            Reported: 0,
            Verified: 0,
            Assigned: 0,
            Fixed: 0
        };

        days.forEach(day => {
            (day.tickets || []).forEach(ticket => {
                const status = String(ticket.status || "Reported");

                if (Object.prototype.hasOwnProperty.call(
                    statusCounts,
                    status
                )) {
                    statusCounts[status]++;
                }
            });
        });

        const pieCanvas = $("rfCalendarPieChart");

        rfCalendarPieChart = new Chart(pieCanvas, {
            type: "pie",

            data: {
                labels: [
                    "Reported",
                    "Verified",
                    "Assigned",
                    "Fixed"
                ],

                datasets: [{
                    data: [
                        statusCounts.Reported,
                        statusCounts.Verified,
                        statusCounts.Assigned,
                        statusCounts.Fixed
                    ],

                    backgroundColor: [
                        "#e9a23b",
                        "#3985f6",
                        "#8958f5",
                        "#159b70"
                    ],

                    borderColor: "#ffffff",
                    borderWidth: 2
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                // Keep all four status names in the pie chart.
                plugins: {
                    legend: {
                        display: true,
                        position: "bottom"
                    },

                    title: {
                        display: true,
                        text: "Monthly Complaint Status"
                    }
                }
            }
        });
    }

    // ------------------------------------------
    // SELECTED DATE DETAILS
    // ------------------------------------------

    function showCalendarDayDetails(date) {
        if (!rfCalendarData) return;

        const day = (rfCalendarData.days || []).find(
            item => item.date === date
        );

        const tickets = day?.tickets || [];

        $("rfCalendarDetailHeading").textContent =
            "Complaints on " +
            new Date(date + "T00:00:00").toLocaleDateString(
                "en-IN",
                {
                    day: "numeric",
                    month: "long",
                    year: "numeric"
                }
            );

        if (!tickets.length) {
            $("rfCalendarDetails").innerHTML = `
                <p>
                    ${day?.reports || 0} reports were submitted on this date.
                    No accepted complaint tickets are linked to this date.
                </p>
            `;

            return;
        }

        $("rfCalendarDetails").innerHTML = `
            <div class="rf-table-wrap">
                <table class="rf-table">
                    <thead>
                        <tr>
                            <th>Ticket</th>
                            <th>Road / Location</th>
                            <th>Damage</th>
                            <th>Severity</th>
                            <th>Status</th>
                            <th>Reports</th>
                            <th>Action</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${tickets.map(ticket => `
                            <tr>
                                <td>${escapeHTML(ticket.ticket_code)}</td>
                                <td>${escapeHTML(ticket.road_name || "-")}</td>
                                <td>${escapeHTML(ticket.damage_type || "-")}</td>
                                <td>${escapeHTML(ticket.severity || "-")}</td>
                                <td>${statusBadge(ticket.status)}</td>
                                <td>${ticket.report_count ?? 0}</td>
                                <td>
                                    <button
                                        class="rf-small-button"
                                        data-ticket-id="${ticket.id}"
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    const calendarMonthInput = $("rfCalendarMonth");

    if (calendarMonthInput) {
        calendarMonthInput.addEventListener("change", () => {
            rfCalendarSelectedDate = null;
            loadMonthlyCalendar();
        });
    }

    // ------------------------------------------
    // LOAD TICKETS
    // ------------------------------------------

    async function loadTickets() {
        try {
            const response = await apiRequest(
                `${API}/tickets?status=all`
            );

            allTickets = await response.json();

            if (!Array.isArray(allTickets)) {
                allTickets = [];
            }

            renderOverview();
            renderComplaints();
            renderDetection();
            renderStatusTickets();
            renderWorkOrders();
            updateMap();

        } catch (error) {
            console.error("Ticket loading error:", error);
            showMessage("Could not load complaints: " + error.message);
        }
    }

    // ------------------------------------------
    // OVERVIEW
    // ------------------------------------------

    function renderOverview() {
        const tickets = [...allTickets]
            .sort((a, b) => priority(b) - priority(a))
            .slice(0, 8);

        $("rfOverviewTable").innerHTML = tickets.length
            ? tickets.map(ticket => `
                <tr data-ticket-id="${ticketId(ticket)}">
                    <td>${escapeHTML(ticketCode(ticket))}</td>
                    <td>${escapeHTML(ticket.road_name || "Location not provided")}</td>
                    <td>${escapeHTML(ticket.damage_type || "-")}</td>
                    <td>${escapeHTML(ticket.severity || "-")}</td>
                    <td>${priority(ticket).toFixed(1)}</td>
                    <td>${statusBadge(ticket.status)}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="6">No complaints available.</td></tr>`;
    }

    // ------------------------------------------
    // ALL COMPLAINTS
    // ------------------------------------------

    function renderComplaints() {
        const search = ($("rfSearch").value || "").toLowerCase();
        const severity = $("rfSeverityFilter").value;

        const filtered = allTickets.filter(ticket => {
            const text = [
                ticketCode(ticket),
                ticket.road_name,
                ticket.damage_type,
                ticket.status
            ].join(" ").toLowerCase();

            return text.includes(search) &&
                (!severity || ticket.severity === severity);
        });

        $("rfComplaintsTable").innerHTML = filtered.length
            ? filtered.map(ticket => `
                <tr data-ticket-id="${ticketId(ticket)}">
                    <td>${escapeHTML(ticketCode(ticket))}</td>
                    <td>${escapeHTML(ticket.road_name || "Not provided")}</td>
                    <td>${escapeHTML(ticket.damage_type || "-")}</td>
                    <td>${escapeHTML(ticket.severity || "-")}</td>
                    <td>${ticket.report_count ?? 0}</td>
                    <td>${priority(ticket).toFixed(1)}</td>
                    <td>${statusBadge(ticket.status)}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="7">No matching complaints found.</td></tr>`;
    }

    $("rfSearch").addEventListener("input", renderComplaints);
    $("rfSeverityFilter").addEventListener("change", renderComplaints);

    $("rfRefresh").addEventListener("click", async () => {
        await loadTickets();
        await loadStats();
    });

    // ------------------------------------------
    // AI DETECTION
    // ------------------------------------------

    function renderDetection() {
        $("rfDetectionGrid").innerHTML = allTickets.length
            ? allTickets.map(ticket => `
                <article class="rf-detection-card">

                    <div class="rf-detection-heading">
                        <strong>${escapeHTML(ticketCode(ticket))}</strong>
                        ${statusBadge(ticket.status)}
                    </div>

                    <div class="rf-image-comparison">
                        <div>
                            <span>ORIGINAL PHOTO</span>
                            <img
                                src="${API}/tickets/${ticketId(ticket)}/photo"
                                alt="Original citizen photo"
                                loading="lazy"
                                onerror="this.classList.add('rf-image-error');this.alt='Original photo unavailable';"
                                data-photo-url="${API}/tickets/${ticketId(ticket)}/photo"
                            >
                        </div>

                        <div>
                            <span>YOLO26 DETECTION</span>
                            <img
                                src="${API}/tickets/${ticketId(ticket)}/detected-photo"
                                alt="YOLO26 detected image"
                                loading="lazy"
                                onerror="this.classList.add('rf-image-error');this.alt='Detection image unavailable';"
                                data-photo-url="${API}/tickets/${ticketId(ticket)}/detected-photo"
                            >
                        </div>
                    </div>

                    <div class="rf-detection-info">
                        <p><strong>Damage:</strong>
                            ${escapeHTML(ticket.damage_type || "-")}</p>

                        <p><strong>Confidence:</strong>
                            ${ticket.ai_confidence ?? "-"}%</p>

                        <p><strong>Damage area:</strong>
                            ${ticket.damage_area_pct ?? "-"}%</p>
                    </div>

                    <button class="rf-small-button"
                            data-ticket-id="${ticketId(ticket)}">
                        View ticket details →
                    </button>

                </article>
            `).join("")
            : `<p>No AI detection records available.</p>`;
    }

    // ------------------------------------------
    // STATUS TRACKING
    // ------------------------------------------

    function selectStatus(status) {
        if (!STATUSES.includes(status)) return;

        selectedStatus = status;

        document.querySelectorAll(".rf-status-tab").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.status === status
            );
        });

        $("rfStatusHeading").textContent =
            status + " Complaints";

        renderStatusTickets();
    }

    document.querySelectorAll(".rf-status-tab").forEach(button => {
        button.addEventListener("click", () => {
            selectStatus(button.dataset.status);
        });
    });

    function renderStatusTickets() {
        const tickets = allTickets.filter(
            ticket => ticket.status === selectedStatus
        );

        $("rfStatusTable").innerHTML = tickets.length
            ? tickets.map(ticket => `
                <tr>
                    <td>${escapeHTML(ticketCode(ticket))}</td>
                    <td>${escapeHTML(ticket.road_name || "-")}</td>
                    <td>${escapeHTML(ticket.damage_type || "-")}</td>
                    <td>${escapeHTML(ticket.severity || "-")}</td>
                    <td>${ticket.report_count ?? 0}</td>
                    <td>${priority(ticket).toFixed(1)}</td>
                    <td>
                        <button class="rf-small-button"
                                data-ticket-id="${ticketId(ticket)}">
                            Open
                        </button>
                    </td>
                </tr>
            `).join("")
            : `<tr><td colspan="7">No ${escapeHTML(selectedStatus)} complaints.</td></tr>`;
    }

    // ------------------------------------------
    // WORK ORDERS
    // ------------------------------------------

    function renderWorkOrders() {
        const search = ($("rfWorkSearch").value || "").toLowerCase();

        const tickets = allTickets.filter(ticket => {
            return [
                ticketCode(ticket),
                ticket.road_name,
                ticket.damage_type,
                ticket.status
            ].join(" ").toLowerCase().includes(search);
        });

        $("rfWorkTable").innerHTML = tickets.length
            ? tickets.map(ticket => `
                <tr>
                    <td>${escapeHTML(ticketCode(ticket))}</td>
                    <td>${escapeHTML(ticket.road_name || "-")}</td>
                    <td>${escapeHTML(ticket.damage_type || "-")}</td>
                    <td>${statusBadge(ticket.status)}</td>
                    <td>
                        <button class="rf-small-button"
                                data-pdf-id="${ticketId(ticket)}">
                            Download PDF
                        </button>
                    </td>
                </tr>
            `).join("")
            : `<tr><td colspan="5">No work orders found.</td></tr>`;
    }

    $("rfWorkSearch").addEventListener("input", renderWorkOrders);

    // ------------------------------------------
    // MAP
    // ------------------------------------------

    function initMap() {
        if (!window.L || !$("map")) return;

        leafletMap = L.map("map").setView(
            [13.0067, 80.2206],
            12
        );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution: "&copy; OpenStreetMap contributors"
            }
        ).addTo(leafletMap);

        markersLayer = L.layerGroup().addTo(leafletMap);
    }

    function updateMap() {
        if (!leafletMap || !markersLayer) return;

        markersLayer.clearLayers();

        allTickets.forEach(ticket => {
            const lat = Number(ticket.lat);
            const lng = Number(ticket.lng);

            if (!Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                !lat || !lng) {
                return;
            }

            const marker = L.marker([lat, lng]);

            marker.bindPopup(`
                <strong>${escapeHTML(ticketCode(ticket))}</strong><br>
                ${escapeHTML(ticket.road_name || "Road location")}<br>
                Damage: ${escapeHTML(ticket.damage_type || "-")}<br>
                Severity: ${escapeHTML(ticket.severity || "-")}<br>
                Status: ${escapeHTML(ticket.status || "-")}
            `);

            markersLayer.addLayer(marker);
        });

        if (markersLayer.getLayers().length) {
            leafletMap.fitBounds(markersLayer.getBounds(), {
                padding: [30, 30],
                maxZoom: 15
            });
        }
    }

    // ------------------------------------------
    // TICKET DETAILS
    // ------------------------------------------

    async function showDetail(id) {
        try {
            const response = await apiRequest(`${API}/tickets/${id}`);
            const ticket = await response.json();

            currentTicketId = id;

            $("rfDetailTitle").textContent =
                ticket.ticket_code || ("Ticket " + id);

            const breakdown = ticket.priority_breakdown || {};

            $("rfDetailBody").innerHTML = `
                <div class="rf-detail-grid">

                    <div><span>Road</span>
                        <strong>${escapeHTML(ticket.road_name || "-")}</strong>
                    </div>

                    <div><span>Damage Type</span>
                        <strong>${escapeHTML(ticket.damage_type || "-")}</strong>
                    </div>

                    <div><span>Severity</span>
                        <strong>${escapeHTML(ticket.severity || "-")}</strong>
                    </div>

                    <div><span>Status</span>
                        <strong>${escapeHTML(ticket.status || "-")}</strong>
                    </div>

                    <div><span>AI Confidence</span>
                        <strong>${ticket.ai_confidence ?? "-"}%</strong>
                    </div>

                    <div><span>Damage Area</span>
                        <strong>${ticket.damage_area_pct ?? "-"}%</strong>
                    </div>

                    <div><span>Reports</span>
                        <strong>${ticket.report_count ?? 0}</strong>
                    </div>

                    <div><span>Priority Score</span>
                        <strong>${ticket.priority ?? breakdown.total ?? "-"}</strong>
                    </div>

                    <div><span>Ticket Code</span>
                        <strong>${escapeHTML(ticket.ticket_code || "-")}</strong>
                    </div>

                    <div><span>First Reported</span>
                        <strong>${escapeHTML(ticket.first_reported || "-")}</strong>
                    </div>

                </div>

                <div class="rf-detail-photos">
                    <div>
                        <span>Original Photo</span>
                        <img src="${API}/tickets/${id}/photo"
                             alt="Original photo"
                             onerror="this.alt='Original photo unavailable';">
                    </div>

                    <div>
                        <span>YOLO26 Detection</span>
                        <img src="${API}/tickets/${id}/detected-photo"
                             alt="Detected photo"
                             onerror="this.alt='Detection photo unavailable';">
                    </div>
                </div>
            `;

            $("rfDetailModal").classList.add("open");

        } catch (error) {
            showMessage("Could not load ticket details: " + error.message);
        }
    }

    $("rfModalClose").addEventListener("click", () => {
        $("rfDetailModal").classList.remove("open");
    });

    $("rfDetailModal").addEventListener("click", event => {
        if (event.target === $("rfDetailModal")) {
            $("rfDetailModal").classList.remove("open");
        }
    });

    // ------------------------------------------
    // UPDATE STATUS
    // ------------------------------------------

    async function updateTicketStatus(id, status) {
        try {
            await apiRequest(`${API}/tickets/${id}/status`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status })
            });

            showMessage("Ticket status updated to " + status);

            await loadTickets();
            await loadStats();

            if (currentTicketId) {
                await showDetail(currentTicketId);
            }

        } catch (error) {
            showMessage("Status update failed: " + error.message);
        }
    }

    document.querySelectorAll("[data-detail-status]").forEach(button => {
        button.addEventListener("click", () => {
            if (!currentTicketId) return;

            updateTicketStatus(
                currentTicketId,
                button.dataset.detailStatus
            );
        });
    });

    // ------------------------------------------
    // PDF WORK ORDER
    // ------------------------------------------

    function downloadPDF(id) {
        if (!id) return;

        window.open(
            `${API}/tickets/${id}/pdf`,
            "_blank"
        );
    }

    $("rfDetailPdf").addEventListener("click", () => {
        downloadPDF(currentTicketId);
    });

    // ------------------------------------------
    // GLOBAL CLICK HANDLING
    // ------------------------------------------

    document.addEventListener("click", event => {
        const detailButton = event.target.closest("[data-ticket-id]");

        if (detailButton) {
            const id = detailButton.dataset.ticketId;

            if (id) {
                showDetail(id);
            }
        }

        const pdfButton = event.target.closest("[data-pdf-id]");

        if (pdfButton) {
            downloadPDF(pdfButton.dataset.pdfId);
        }

        const photo = event.target.closest("[data-photo-url]");

        if (photo) {
            $("rfPhotoImage").src = photo.dataset.photoUrl;
            $("rfPhotoModal").classList.add("open");
        }
    });

    // ------------------------------------------
    // PHOTO VIEWER
    // ------------------------------------------

    $("rfPhotoClose").addEventListener("click", () => {
        $("rfPhotoModal").classList.remove("open");
        $("rfPhotoImage").src = "";
    });

    $("rfPhotoModal").addEventListener("click", event => {
        if (event.target === $("rfPhotoModal")) {
            $("rfPhotoModal").classList.remove("open");
            $("rfPhotoImage").src = "";
        }
    });

    // ------------------------------------------
    // START DASHBOARD
    // ------------------------------------------

    document.addEventListener("DOMContentLoaded", async () => {
        setCurrentCalendarMonth();

        initMap();

        selectStatus("Reported");

        await loadStats();
        await loadTickets();
    });

})();

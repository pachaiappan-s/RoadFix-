
import os
import uuid
import traceback

from datetime import datetime
from functools import wraps
from math import radians, sin, cos, sqrt, atan2

from flask import (
    Flask,
    request,
    jsonify,
    send_from_directory,
    session,
    redirect,
    send_file
)

from flask_cors import CORS
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from sqlalchemy import inspect, text

from database import db
from models import Ticket, Report
from ai_detector import detect_damage, get_severity
from priority import priority_score, classify_road, STATUS_ORDER
from pdf_generator import generate_work_order_pdf
from email_utils import send_status_email


# ==================================================
# CONFIGURATION
# ==================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DETECTED_DIR = os.path.join(BASE_DIR, "detected")

FRONTEND_DIR = os.path.abspath(
    os.path.join(BASE_DIR, "..", "frontend")
)

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DETECTED_DIR, exist_ok=True)

app = Flask(
    __name__,
    static_folder=FRONTEND_DIR,
    static_url_path=""
)

app.config["SQLALCHEMY_DATABASE_URI"] = (
    "sqlite:///" +
    os.path.join(BASE_DIR, "roadfix.db").replace("\\", "/")
)

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

secret_key = os.getenv("FLASK_SECRET_KEY")

if not secret_key:
    raise RuntimeError("FLASK_SECRET_KEY environment variable is required.")

app.secret_key = secret_key

db.init_app(app)
CORS(app)

CONF_THRESHOLD = 0.1
MERGE_RADIUS_M = 20

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")

if not ADMIN_USERNAME or not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_USERNAME and ADMIN_PASSWORD must be configured.")
ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".jfif", ".bmp", ".tif", ".tiff"
}

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff"
}


# ==================================================
# CITIZEN DATABASE TABLE
# ==================================================

class CitizenUser(db.Model):

    __tablename__ = "citizen_users"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(254), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# NEW CITIZEN ACCOUNT TABLE
class CitizenAccount(db.Model):

    __tablename__ = "citizen_accounts"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# ==================================================
# DATABASE MIGRATION
# ==================================================

def update_database():

    """
    Create missing tables and add detected_photo_path
    to an existing SQLite ticket table if necessary.
    """

    db.create_all()

    columns = inspect(db.engine).get_columns("ticket")

    column_names = [
        column["name"] for column in columns
    ]

    if "detected_photo_path" not in column_names:

        with db.engine.begin() as connection:

            connection.execute(
                text(
                    "ALTER TABLE ticket "
                    "ADD COLUMN detected_photo_path VARCHAR(300)"
                )
            )

        print("Database updated: detected_photo_path added.")

    else:

        print("Database already contains detected_photo_path.")


# ==================================================
# AUTHENTICATION HELPERS
# ==================================================

def login_required_page(f):

    @wraps(f)
    def wrapper(*args, **kwargs):

        if not session.get("logged_in"):
            return redirect("/login")

        return f(*args, **kwargs)

    return wrapper


def login_required_api(f):

    @wraps(f)
    def wrapper(*args, **kwargs):

        if not session.get("logged_in"):

            return jsonify({
                "error": "Unauthorized"
            }), 401

        return f(*args, **kwargs)

    return wrapper


# ==================================================
# UTILITY FUNCTIONS
# ==================================================

def haversine_m(lat1, lon1, lat2, lon2):

    earth_radius = 6371000

    phi1 = radians(lat1)
    phi2 = radians(lat2)

    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = (
        sin(dphi / 2) ** 2
        + cos(phi1) * cos(phi2)
        * sin(dlambda / 2) ** 2
    )

    a = max(0.0, min(1.0, a))

    return 2 * earth_radius * atan2(
        sqrt(a),
        sqrt(1 - a)
    )


def next_ticket_code():

    n = Ticket.query.count() + 1

    while True:

        code = f"RF-{1000 + n}"

        if not Ticket.query.filter_by(
            ticket_code=code
        ).first():

            return code

        n += 1


def allowed_file(filename, content_type=None):

    if not filename:
        return False

    extension = os.path.splitext(filename)[1].lower()

    if extension not in ALLOWED_EXTENSIONS:
        return False

    if content_type and content_type not in ALLOWED_MIME_TYPES:

        if content_type != "application/octet-stream":
            return False

    return True


def parse_coordinates():

    try:

        lat = float(request.form.get("lat", ""))
        lng = float(request.form.get("lng", ""))

    except (ValueError, TypeError):

        raise ValueError(
            "Valid latitude and longitude are required."
        )

    if not -90 <= lat <= 90:

        raise ValueError(
            "Latitude must be between -90 and 90."
        )

    if not -180 <= lng <= 180:

        raise ValueError(
            "Longitude must be between -180 and 180."
        )

    return lat, lng


def attach_pdf_image_paths(ticket):

    """
    Connect the database image filenames to the actual files.

    Original photograph:
        backend/uploads/

    YOLO annotated photograph:
        backend/detected/
    """

    original_filename = ticket.photo_path

    detected_filename = ticket.detected_photo_path

    ticket.original_image_path = (
        os.path.join(UPLOAD_DIR, original_filename)
        if original_filename else None
    )

    ticket.detected_image_path = (
        os.path.join(DETECTED_DIR, detected_filename)
        if detected_filename else None
    )

    return ticket


# ==================================================
# PAGE ROUTES
# ==================================================

@app.route("/")
def home():

    return redirect("/user")


@app.route("/user")
def serve_citizen():

    return send_from_directory(
        FRONTEND_DIR,
        "citizen.html"
    )


@app.route("/admin")
@login_required_page
def serve_admin():

    return send_from_directory(
        FRONTEND_DIR,
        "admin.html"
    )


# ==================================================
# ADMIN LOGIN
# ==================================================

@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "GET":

        if session.get("logged_in"):
            return redirect("/admin")

        return send_from_directory(
            FRONTEND_DIR,
            "login.html"
        )

    username = request.form.get("username", "")
    password = request.form.get("password", "")

    if (
        username == ADMIN_USERNAME
        and password == ADMIN_PASSWORD
    ):

        session.clear()
        session["logged_in"] = True

        return redirect("/admin")

    return redirect("/login?error=1")


# ==================================================
# ADMIN LOGOUT
# ==================================================

@app.route("/logout")
def logout():

    session.clear()

    return redirect("/login")

# ==================================================
# CITIZEN SIGNUP
# ==================================================

@app.route("/user-signup", methods=["GET", "POST"])
def user_signup():

    if request.method == "GET":
        return send_from_directory(
            FRONTEND_DIR,
            "user-auth.html"
        )

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")

    if len(username) < 3 or len(username) > 30:
        return "Username must be between 3 and 30 characters.", 400

    if not username.replace("_", "").isalnum():
        return "Use only letters, numbers and underscores.", 400

    if len(password) < 6:
        return "Password must contain at least 6 characters.", 400

    if password != confirm_password:
        return "Passwords do not match.", 400

    existing_user = CitizenAccount.query.filter_by(
        username=username
    ).first()

    if existing_user:
        return "Username already exists. Please choose another.", 409

    new_user = CitizenAccount(
        username=username,
        password_hash=generate_password_hash(password)
    )

    try:
        db.session.add(new_user)
        db.session.commit()

        session["citizen_id"] = new_user.id
        session["citizen_username"] = new_user.username

        return redirect("/user")

    except Exception:
        db.session.rollback()
        traceback.print_exc()
        return "Could not create your account. Please try again.", 500


# ==================================================
# CITIZEN LOGIN
# ==================================================

@app.route("/user-login", methods=["GET", "POST"])
def user_login():

    if request.method == "GET":
        return send_from_directory(
            FRONTEND_DIR,
            "user-auth.html"
        )

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password", "")

    account = CitizenAccount.query.filter_by(
        username=username
    ).first()

    if account and check_password_hash(
        account.password_hash,
        password
    ):

        session["citizen_id"] = account.id
        session["citizen_username"] = account.username

        return redirect("/user")

    return "Invalid username or password.", 401


# ==================================================
# CITIZEN LOGOUT
# ==================================================

@app.route("/user-logout")
def user_logout():

    session.pop("citizen_id", None)
    session.pop("citizen_username", None)

    return redirect("/user")



# ==================================================
# CITIZEN: SUBMIT ROAD DAMAGE REPORT
# ==================================================

@app.route("/api/reports", methods=["POST"])
def submit_report():

    try:

        return submit_report_inner()

    except ValueError as exc:

        db.session.rollback()

        return jsonify({
            "accepted": False,
            "message": str(exc)
        }), 400

    except Exception:

        traceback.print_exc()

        db.session.rollback()

        app.logger.exception(
            "Unexpected report submission error"
        )

        return jsonify({
            "accepted": False,
            "message": "An unexpected server error occurred."
        }), 500


def submit_report_inner():

    photo = request.files.get("photo")

    if photo is None or not photo.filename:

        raise ValueError(
            "Please select a road-damage photo."
        )

    if not allowed_file(photo.filename, photo.mimetype):

        raise ValueError(
            "Unsupported image format. Please upload JPG, JPEG, "
            "PNG, WEBP, JFIF, BMP or TIFF."
        )

    lat, lng = parse_coordinates()

    road_name = (
        request.form.get("road_name") or "Unknown Road"
    ).strip()[:200]

    citizen_email = (
        request.form.get("citizen_email") or ""
    ).strip() or None

    if citizen_email and (
        len(citizen_email) > 254
        or "\n" in citizen_email
        or "\r" in citizen_email
        or "@" not in citizen_email
    ):

        raise ValueError(
            "Please provide a valid email address."
        )

    # ----------------------------------------------
    # SAVE ORIGINAL CITIZEN PHOTO
    # ----------------------------------------------

    original_name = secure_filename(photo.filename)

    extension = os.path.splitext(original_name)[1].lower()

    filename = f"{uuid.uuid4().hex}{extension}"

    original_path = os.path.join(
        UPLOAD_DIR,
        filename
    )

    photo.save(original_path)

    # ----------------------------------------------
    # YOLO AI DETECTION
    # ----------------------------------------------

    try:

        result = detect_damage(original_path)

    except Exception:

        app.logger.exception(
            "Road-damage detection failed"
        )

        return jsonify({
            "accepted": False,
            "message": (
                "AI detection is currently unavailable. "
                "Check the detector configuration and try again."
            )
        }), 502

    if result is not None and not isinstance(result, dict):

        raise RuntimeError(
            "The AI detector returned an invalid result."
        )

    try:

        confidence = (
            float(result["confidence"])
            if result else 0.0
        )

    except (KeyError, ValueError, TypeError):

        raise RuntimeError(
            "The AI detector returned invalid confidence data."
        )

    if confidence > 1.0:
        confidence = confidence / 100.0

    confidence = max(0.0, min(1.0, confidence))

    # ----------------------------------------------
    # CHECK DETECTION CONFIDENCE
    # ----------------------------------------------

    if not result or confidence < CONF_THRESHOLD:

        db.session.add(
            Report(
                photo_path=filename,
                lat=lat,
                lng=lng,
                confidence=confidence,
                accepted=False
            )
        )

        db.session.commit()

        return jsonify({
            "accepted": False,
            "message": (
                "No road damage found with sufficient confidence."
            )
        }), 200

    # ----------------------------------------------
    # GET YOLO DETECTED IMAGE FILENAME
    # ----------------------------------------------

    detected_filename = result.get("detected_image")

    if detected_filename:

        detected_filename = os.path.basename(
            detected_filename
        )

        detected_path = os.path.join(
            DETECTED_DIR,
            detected_filename
        )

        if not os.path.isfile(detected_path):

            app.logger.warning(
                "YOLO detected image was not found: %s",
                detected_path
            )

            detected_filename = None

    # ----------------------------------------------
    # VALIDATE DETECTION RESULTS
    # ----------------------------------------------

    damage_type = result.get("damage_type")

    if not damage_type:

        raise RuntimeError(
            "The AI detector did not return a damage type."
        )

    try:

        area_pct = float(result["area_pct"])

    except (KeyError, ValueError, TypeError):

        raise RuntimeError(
            "The AI detector returned an invalid damage area."
        )

    if not 0 <= area_pct <= 100:

        raise RuntimeError(
            "The damage area percentage is out of range."
        )

    severity = get_severity(area_pct)

    # ----------------------------------------------
    # CHECK NEARBY DUPLICATE COMPLAINTS
    # ----------------------------------------------

    candidates = Ticket.query.filter(
        Ticket.status != "Fixed",
        Ticket.damage_type == damage_type
    ).all()

    match = next(
        (
            ticket
            for ticket in candidates
            if haversine_m(
                lat,
                lng,
                ticket.lat,
                ticket.lng
            ) <= MERGE_RADIUS_M
        ),
        None
    )

    if match:

        match.report_count += 1

        if (
            severity == "High"
            or (
                severity == "Medium"
                and match.severity == "Low"
            )
        ):

            match.severity = severity

        if citizen_email:
            match.citizen_email = citizen_email

        # Preserve the original ticket's main image.
        # Fill its detected image only if it is missing.
        if not match.detected_photo_path and detected_filename:

            match.detected_photo_path = detected_filename

        ticket = match

    else:

        ticket = Ticket(
            ticket_code=next_ticket_code(),
            road_name=road_name,
            lat=lat,
            lng=lng,
            damage_type=damage_type,
            severity=severity,
            ai_confidence=confidence,
            damage_area_pct=area_pct,
            road_class_score=classify_road(road_name),
            report_count=1,
            status="Reported",
            photo_path=filename,
            detected_photo_path=detected_filename,
            citizen_email=citizen_email
        )

        db.session.add(ticket)

    db.session.flush()

    # ----------------------------------------------
    # SAVE REPORT RECORD
    # ----------------------------------------------

    db.session.add(
        Report(
            ticket_id=ticket.id,
            photo_path=filename,
            lat=lat,
            lng=lng,
            confidence=confidence,
            accepted=True
        )
    )

    db.session.commit()

    return jsonify({
        "accepted": True,
        "ticket": ticket.to_dict()
    }), 201


# ==================================================
# CITIZEN: LOOK UP FULL TICKET DETAILS
# ==================================================

@app.route("/api/lookup/<ticket_code>", methods=["GET"])
def lookup_ticket(ticket_code):

    ticket = Ticket.query.filter_by(
        ticket_code=ticket_code.strip().upper()
    ).first()

    if not ticket:

        return jsonify({
            "error": "Ticket not found. Please check your ticket number."
        }), 404

    data = ticket.to_dict()

    data["photo_url"] = (
        f"/api/lookup/{ticket.ticket_code}/photo"
        if ticket.photo_path else None
    )

    data["pdf_url"] = (
        f"/api/lookup/{ticket.ticket_code}/pdf"
    )

    return jsonify(data)


# ==================================================
# CITIZEN: VIEW ORIGINAL UPLOADED PHOTOGRAPH
# ==================================================

@app.route(
    "/api/lookup/<ticket_code>/photo",
    methods=["GET"]
)
def citizen_ticket_photo(ticket_code):

    ticket = Ticket.query.filter_by(
        ticket_code=ticket_code.strip().upper()
    ).first()

    if not ticket:

        return jsonify({
            "error": "Ticket not found."
        }), 404

    if not ticket.photo_path:

        return jsonify({
            "error": "Original complaint photograph is unavailable."
        }), 404

    return send_from_directory(
        UPLOAD_DIR,
        ticket.photo_path
    )


# ==================================================
# CITIZEN: DOWNLOAD COMPLAINT PDF
# ==================================================

@app.route(
    "/api/lookup/<ticket_code>/pdf",
    methods=["GET"]
)
def citizen_ticket_pdf(ticket_code):

    ticket = Ticket.query.filter_by(
        ticket_code=ticket_code.strip().upper()
    ).first()

    if not ticket:

        return jsonify({
            "error": "Ticket not found."
        }), 404

    priority = priority_score(ticket)

    attach_pdf_image_paths(ticket)

    pdf_buffer = generate_work_order_pdf(
        ticket,
        priority
    )

    return send_file(
        pdf_buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{ticket.ticket_code}_complaint.pdf"
    )


# ==================================================
# ADMIN: LIST TICKETS
# ==================================================

@app.route("/api/tickets", methods=["GET"])
@login_required_api
def list_tickets():

    status_filter = request.args.get(
        "status",
        "open"
    )

    severity_filter = request.args.get("severity")

    query = Ticket.query

    if status_filter == "open":

        query = query.filter(
            Ticket.status != "Fixed"
        )

    elif status_filter in STATUS_ORDER:

        query = query.filter(
            Ticket.status == status_filter
        )

    if severity_filter:

        query = query.filter(
            Ticket.severity == severity_filter
        )

    results = []

    for ticket in query.all():

        priority = priority_score(ticket)

        results.append(
            ticket.to_dict(
                priority=priority["total"]
            )
        )

    results.sort(
        key=lambda item: item.get("priority", 0),
        reverse=True
    )

    return jsonify(results)


# ==================================================
# ADMIN: TICKET DETAILS
# ==================================================

@app.route(
    "/api/tickets/<int:ticket_id>",
    methods=["GET"]
)
@login_required_api
def ticket_detail(ticket_id):

    ticket = Ticket.query.get_or_404(ticket_id)

    priority = priority_score(ticket)

    data = ticket.to_dict()

    data["priority_breakdown"] = priority

    return jsonify(data)


# ==================================================
# ADMIN: VIEW ORIGINAL CITIZEN PHOTO
# ==================================================

@app.route(
    "/api/tickets/<int:ticket_id>/photo",
    methods=["GET"]
)
@login_required_api
def ticket_photo(ticket_id):

    ticket = Ticket.query.get_or_404(ticket_id)

    if not ticket.photo_path:

        return jsonify({
            "error": "No original photo available."
        }), 404

    return send_from_directory(
        UPLOAD_DIR,
        ticket.photo_path
    )


# ==================================================
# ADMIN: VIEW YOLO DETECTED PHOTO
# ==================================================

@app.route(
    "/api/tickets/<int:ticket_id>/detected-photo",
    methods=["GET"]
)
@login_required_api
def ticket_detected_photo(ticket_id):

    ticket = Ticket.query.get_or_404(ticket_id)

    if not ticket.detected_photo_path:

        return jsonify({
            "error": "No detected photo available."
        }), 404

    return send_from_directory(
        DETECTED_DIR,
        ticket.detected_photo_path
    )


# ==================================================
# ADMIN: UPDATE TICKET STATUS
# ==================================================

@app.route(
    "/api/tickets/<int:ticket_id>/status",
    methods=["PATCH"]
)
@login_required_api
def update_status(ticket_id):

    ticket = Ticket.query.get_or_404(ticket_id)

    body = request.get_json(silent=True) or {}

    new_status = body.get("status")

    if new_status not in STATUS_ORDER:

        return jsonify({
            "error": "Invalid status"
        }), 400

    ticket.status = new_status

    if (
        new_status == "Fixed"
        and ticket.fixed_at is None
    ):

        ticket.fixed_at = datetime.utcnow()

    db.session.commit()

    if ticket.citizen_email:

        try:

            priority = priority_score(ticket)

            attach_pdf_image_paths(ticket)

            pdf_buffer = generate_work_order_pdf(
                ticket,
                priority
            )

            send_status_email(
                ticket.citizen_email,
                ticket,
                pdf_buffer=pdf_buffer
            )

        except Exception:

            app.logger.exception(
                "Could not generate or send status email"
            )

    return jsonify(ticket.to_dict())


# ==================================================
# ADMIN: DOWNLOAD WORK ORDER PDF
# ==================================================

@app.route(
    "/api/tickets/<int:ticket_id>/pdf",
    methods=["GET"]
)
@login_required_api
def ticket_pdf(ticket_id):

    ticket = Ticket.query.get_or_404(ticket_id)

    priority = priority_score(ticket)

    attach_pdf_image_paths(ticket)

    buffer = generate_work_order_pdf(
        ticket,
        priority
    )

    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{ticket.ticket_code}_workorder.pdf"
    )

# ==================================================
# ADMIN: MONTHLY REPORT CALENDAR
# ==================================================

@app.route("/api/calendar", methods=["GET"])
@login_required_api
def monthly_calendar():

    month_value = request.args.get("month", "")

    try:
        selected_month = datetime.strptime(
            month_value, "%Y-%m"
        )

        start_date = selected_month.replace(
            day=1, hour=0, minute=0, second=0,
            microsecond=0
        )

        if selected_month.month == 12:
            end_date = start_date.replace(
                year=start_date.year + 1,
                month=1
            )
        else:
            end_date = start_date.replace(
                month=start_date.month + 1
            )

    except ValueError:
        return jsonify({
            "error": "Invalid month. Use YYYY-MM."
        }), 400

    # Get all reports submitted during the selected month.
    reports = Report.query.filter(
        Report.created_at >= start_date,
        Report.created_at < end_date
    ).order_by(Report.created_at.asc()).all()

    # Get the unique tickets associated with those reports.
    ticket_ids = {
        report.ticket_id
        for report in reports
        if report.ticket_id is not None
    }

    tickets = Ticket.query.filter(
        Ticket.id.in_(ticket_ids)
    ).all() if ticket_ids else []

    ticket_map = {
        ticket.id: ticket
        for ticket in tickets
    }

    completed = sum(
        1 for ticket in tickets
        if ticket.status == "Fixed"
    )

    incomplete = len(tickets) - completed

    # Prepare one calendar entry for every day of the month.
    days = {}

    current_date = start_date.date()

    while current_date < end_date.date():

        day_key = current_date.isoformat()

        days[day_key] = {
            "date": day_key,
            "reports": 0,
            "tickets": {}
        }

        from datetime import timedelta
        current_date += timedelta(days=1)

    # Count submitted reports and attach their ticket details.
    accepted_reports = 0
    rejected_reports = 0

    for report in reports:

        day_key = report.created_at.date().isoformat()

        days[day_key]["reports"] += 1

        if report.accepted:
            accepted_reports += 1
        else:
            rejected_reports += 1

        ticket = ticket_map.get(report.ticket_id)

        if ticket:
            days[day_key]["tickets"][ticket.id] = {
                "id": ticket.id,
                "ticket_code": ticket.ticket_code,
                "road_name": ticket.road_name,
                "damage_type": ticket.damage_type,
                "severity": ticket.severity,
                "status": ticket.status,
                "report_count": ticket.report_count
            }

    # Convert ticket dictionaries into lists for the frontend.
    calendar_days = []

    for day in days.values():

        day["tickets"] = list(
            day["tickets"].values()
        )

        calendar_days.append(day)

    return jsonify({
        "month": month_value,
        "total_reports": len(reports),
        "accepted_reports": accepted_reports,
        "rejected_reports": rejected_reports,
        "total_complaints": len(tickets),
        "completed": completed,
        "incomplete": incomplete,
        "days": calendar_days
    })


# ==================================================
# ADMIN: DASHBOARD STATISTICS
# ==================================================

@app.route("/api/stats", methods=["GET"])
@login_required_api
def stats():

    open_tickets = Ticket.query.filter(
        Ticket.status != "Fixed"
    ).count()

    total_tickets = Ticket.query.count()

    accepted_reports = Report.query.filter_by(
        accepted=True
    ).count()

    rejected_reports = Report.query.filter_by(
        accepted=False
    ).count()

    total_reports = (
        accepted_reports + rejected_reports
    )

    duplicates_merged = max(
        0,
        accepted_reports - total_tickets
    )

    dup_pct = (
        round(
            duplicates_merged / accepted_reports * 100,
            1
        )
        if accepted_reports else 0
    )

    rej_pct = (
        round(
            rejected_reports / total_reports * 100,
            1
        )
        if total_reports else 0
    )

    fixed_tickets = Ticket.query.filter(
        Ticket.status == "Fixed",
        Ticket.fixed_at.isnot(None),
        Ticket.first_reported.isnot(None)
    ).all()

    if fixed_tickets:

        avg_days = sum(
            (
                ticket.fixed_at - ticket.first_reported
            ).total_seconds()
            for ticket in fixed_tickets
        ) / len(fixed_tickets) / 86400

    else:

        avg_days = 0

    pipeline = {
        status: Ticket.query.filter_by(
            status=status
        ).count()
        for status in STATUS_ORDER
    }

    return jsonify({
        "open_tickets": open_tickets,
        "duplicates_merged_pct": dup_pct,
        "avg_repair_days": round(avg_days, 1),
        "rejected_pct": rej_pct,
        "pipeline": pipeline,
        "total_tickets": total_tickets
    })


# ==================================================
# START APPLICATION
# ==================================================

if __name__ == "__main__":

    with app.app_context():
        update_database()

    debug_mode = (
        os.getenv("FLASK_DEBUG", "").lower() == "true"
    )

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=debug_mode
    )

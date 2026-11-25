
import os
from io import BytesIO
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth


# =========================================================
# FOLDERS
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DETECTED_DIR = os.path.join(BASE_DIR, "detected")


# =========================================================
# GENERAL HELPERS
# =========================================================

def get_value(obj, *names, default=""):
    """Get the first available attribute from a ticket."""

    for name in names:
        value = getattr(obj, name, None)

        if value is not None and value != "":
            return value

    return default


def resolve_image_path(ticket, attribute_names, folder):
    """
    Find the actual image file.

    Original image:
        backend/uploads/

    YOLO annotated image:
        backend/detected/
    """

    for name in attribute_names:

        value = getattr(ticket, name, None)

        if not value:
            continue

        try:
            value = os.fspath(value)
        except TypeError:
            continue

        # Check whether the supplied path already exists.
        if os.path.isfile(value):
            return value

        # Check relative to the backend folder.
        backend_path = os.path.join(BASE_DIR, value)

        if os.path.isfile(backend_path):
            return backend_path

        # Check the expected image folder using its filename.
        folder_path = os.path.join(
            folder,
            os.path.basename(value)
        )

        if os.path.isfile(folder_path):
            return folder_path

    return None


def draw_wrapped_text(
    c,
    text,
    x,
    y,
    max_width,
    font="Helvetica",
    size=10
):
    """Draw text across multiple lines."""

    c.setFont(font, size)

    words = str(text).split()
    line = ""

    for word in words:

        test_line = f"{line} {word}".strip()

        if stringWidth(test_line, font, size) <= max_width:
            line = test_line

        else:
            if line:
                c.drawString(x, y, line)
                y -= 15

            line = word

    if line:
        c.drawString(x, y, line)
        y -= 15

    return y


def draw_heading(c, text, y):

    c.setFillColor(colors.HexColor("#17365D"))
    c.setFont("Helvetica-Bold", 12)

    c.drawString(45, y, text)

    c.setStrokeColor(colors.HexColor("#D5DFEA"))
    c.line(45, y - 6, 550, y - 6)

    c.setFillColor(colors.black)

    return y - 25


# =========================================================
# IMAGE DRAWING
# =========================================================

def draw_image(c, image_path, title, y):

    """
    Draw the actual citizen photo or YOLO annotated copy.

    If an image is missing, display a message instead
    of silently leaving the PDF blank.
    """

    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(colors.HexColor("#17365D"))
    c.drawString(45, y, title)

    y -= 18

    if not image_path or not os.path.isfile(image_path):

        c.setFillColor(colors.red)
        c.setFont("Helvetica", 9)
        c.drawString(
            50,
            y - 5,
            "Image not found. Please check the image file path."
        )

        c.setFillColor(colors.black)

        return y - 30

    try:

        image = ImageReader(image_path)

        image_width, image_height = image.getSize()

        if image_width <= 0 or image_height <= 0:
            raise ValueError("Invalid image dimensions")

        max_width = 500
        max_height = 220

        scale = min(
            max_width / image_width,
            max_height / image_height
        )

        display_width = image_width * scale
        display_height = image_height * scale

        # Start a new page if the image does not fit.
        if y - display_height < 55:

            c.showPage()

            y = A4[1] - 60

        c.setStrokeColor(colors.HexColor("#D5DFEA"))

        c.rect(
            42,
            y - display_height - 3,
            display_width + 6,
            display_height + 6,
            fill=0,
            stroke=1
        )

        c.drawImage(
            image,
            45,
            y - display_height,
            width=display_width,
            height=display_height,
            preserveAspectRatio=True,
            mask="auto"
        )

        print("PDF image added:", image_path)

        return y - display_height - 30

    except Exception as error:

        print("PDF image error:", image_path, error)

        c.setFillColor(colors.red)
        c.setFont("Helvetica", 9)

        c.drawString(
            50,
            y - 5,
            "This image could not be loaded into the PDF."
        )

        c.setFillColor(colors.black)

        return y - 30


# =========================================================
# MAIN PDF GENERATOR
# =========================================================

def generate_work_order_pdf(ticket, priority_breakdown):

    buffer = BytesIO()

    c = canvas.Canvas(buffer, pagesize=A4)

    width, height = A4

    # =====================================================
    # TICKET INFORMATION
    # =====================================================

    ticket_code = get_value(
        ticket,
        "ticket_code",
        default="Not available"
    )

    road_name = get_value(
        ticket,
        "road_name",
        default="Not available"
    )

    damage_type = get_value(
        ticket,
        "damage_type",
        default="Road damage"
    )

    severity = get_value(
        ticket,
        "severity",
        default="Not specified"
    )

    status = get_value(
        ticket,
        "status",
        default="Reported"
    )

    crew = get_value(
        ticket,
        "crew",
        default="Unassigned"
    )

    latitude = get_value(
        ticket,
        "lat",
        default="Not available"
    )

    longitude = get_value(
        ticket,
        "lng",
        default="Not available"
    )

    confidence = get_value(
        ticket,
        "ai_confidence",
        default=0
    )

    damage_area = get_value(
        ticket,
        "damage_area_pct",
        default=0
    )

    try:
        confidence = round(float(confidence) * 100, 1)
    except (ValueError, TypeError):
        confidence = 0

    try:
        damage_area = round(float(damage_area), 2)
    except (ValueError, TypeError):
        damage_area = 0

    report_count = get_value(
        ticket,
        "report_count",
        default=1
    )

    first_reported = get_value(
        ticket,
        "first_reported"
    )

    if isinstance(first_reported, datetime):

        reported_date = first_reported.strftime("%d %B %Y")

    elif first_reported:

        reported_date = str(first_reported)

    else:

        reported_date = "Not available"

    # =====================================================
    # FIND ORIGINAL CITIZEN IMAGE
    # =====================================================

    original_image = resolve_image_path(
        ticket,
        [
            "original_image_path",
            "original_image",
            "photo_path",
            "image_path",
            "image_filename"
        ],
        UPLOAD_DIR
    )

    # =====================================================
    # FIND YOLO ANNOTATED IMAGE
    # =====================================================

    detected_image = resolve_image_path(
        ticket,
        [
            "detected_image_path",
            "detected_image",
            "detected_photo_path",
            "annotated_image",
            "annotated_image_path"
        ],
        DETECTED_DIR
    )

    print("====================================")
    print("ROADFIX PDF IMAGE CHECK")
    print("Original image:", original_image)
    print("Detected image:", detected_image)
    print("====================================")

    # =====================================================
    # PAGE 1 - OFFICIAL COMPLAINT LETTER
    # =====================================================

    c.setFillColor(colors.HexColor("#17365D"))

    c.rect(
        0,
        height - 100,
        width,
        100,
        fill=1,
        stroke=0
    )

    c.setFillColor(colors.white)

    c.setFont("Helvetica-Bold", 25)

    c.drawCentredString(
        width / 2,
        height - 43,
        "ROADFIX"
    )

    c.setFont("Helvetica", 11)

    c.drawCentredString(
        width / 2,
        height - 65,
        "OFFICIAL ROAD DAMAGE COMPLAINT REPORT"
    )

    c.setFillColor(colors.black)

    y = height - 130

    c.setFont("Helvetica-Bold", 12)

    c.drawString(
        45,
        y,
        "COMPLAINT REFERENCE"
    )

    c.setFont("Helvetica-Bold", 11)

    c.drawRightString(
        550,
        y,
        str(ticket_code)
    )

    y -= 35

    y = draw_heading(
        c,
        "1. COMPLAINT DETAILS",
        y
    )

    details = [
        ("Complaint ID", ticket_code),
        ("Complaint Date", reported_date),
        ("Road / Location", road_name),
        ("Damage Type", damage_type),
        ("Severity", severity),
        ("Current Status", status),
        ("Latitude", latitude),
        ("Longitude", longitude),
        ("Total Reports", report_count),
    ]

    for label, value in details:

        c.setFont("Helvetica-Bold", 10)

        c.drawString(
            50,
            y,
            f"{label}:"
        )

        c.setFont("Helvetica", 10)

        c.drawString(
            175,
            y,
            str(value)
        )

        y -= 21

    y -= 10

    y = draw_heading(
        c,
        "2. AI POTHOLE DETECTION RESULTS",
        y
    )

    ai_details = [
        ("Detected Damage", damage_type),
        ("AI Confidence", f"{confidence}%"),
        ("Damage Area", f"{damage_area}% of image"),
    ]

    for label, value in ai_details:

        c.setFont("Helvetica-Bold", 10)

        c.drawString(
            50,
            y,
            f"{label}:"
        )

        c.setFont("Helvetica", 10)

        c.drawString(
            175,
            y,
            str(value)
        )

        y -= 21

    y -= 10

    y = draw_heading(
        c,
        "3. OFFICIAL COMPLAINT LETTER",
        y
    )

    paragraphs = [

        "To,",

        "The Municipal Corporation / Road Maintenance Department,",

        "",

        "Subject: Complaint regarding road damage / pothole.",

        "",

        "Respected Sir/Madam,",

        "",

        (
            f"I would like to bring to your attention the road damage "
            f"reported at {road_name}. The reported damage type is "
            f"{damage_type} with a severity level of {severity}."
        ),

        "",

        (
            "This road damage may cause inconvenience and create "
            "potential safety risks for road users. The attached "
            "photographs and AI detection results are provided as "
            "supporting evidence."
        ),

        "",

        (
            "I kindly request the concerned authority to inspect "
            "the location and take the necessary repair action "
            "as soon as possible."
        ),

        "",

        "Thank you.",

        "",

        "Submitted through: RoadFix Online Complaint System",
    ]

    for paragraph in paragraphs:

        if not paragraph:

            y -= 9
            continue

        y = draw_wrapped_text(
            c,
            paragraph,
            50,
            y,
            490,
            size=9.5
        )

    c.setFont("Helvetica-Bold", 10)

    c.drawString(
        50,
        max(y - 15, 55),
        "RoadFix Complaint Management System"
    )

    c.setStrokeColor(colors.HexColor("#D5DFEA"))

    c.line(
        45,
        40,
        550,
        40
    )

    c.setFont("Helvetica", 8)

    c.drawCentredString(
        width / 2,
        27,
        "Generated electronically by RoadFix"
    )

    # =====================================================
    # PAGE 2 - PHOTOGRAPHIC EVIDENCE
    # =====================================================

    c.showPage()

    c.setFillColor(colors.HexColor("#17365D"))

    c.rect(
        0,
        height - 75,
        width,
        75,
        fill=1,
        stroke=0
    )

    c.setFillColor(colors.white)

    c.setFont("Helvetica-Bold", 17)

    c.drawCentredString(
        width / 2,
        height - 43,
        "PHOTOGRAPHIC EVIDENCE"
    )

    c.setFillColor(colors.black)

    y = height - 110

    c.setFont("Helvetica", 9)

    c.drawString(
        45,
        y,
        f"Complaint ID: {ticket_code}"
    )

    y -= 30

    # -----------------------------------------------------
    # BEFORE DETECTION - ORIGINAL CITIZEN PHOTO
    # -----------------------------------------------------

    y = draw_heading(
        c,
        "4. BEFORE DETECTION - ORIGINAL CITIZEN PHOTO",
        y
    )

    y = draw_image(
        c,
        original_image,
        "Original photograph uploaded by the citizen",
        y
    )

    # -----------------------------------------------------
    # AFTER DETECTION - SAME PHOTO WITH YOLO BOX
    # -----------------------------------------------------

    y = draw_heading(
        c,
        "5. AFTER DETECTION - YOLO ANNOTATED PHOTO",
        y
    )

    y = draw_image(
        c,
        detected_image,
        "Same photograph with YOLO pothole detection",
        y
    )

    if not original_image:

        print("WARNING: Original citizen photograph not found.")

    if not detected_image:

        print("WARNING: YOLO annotated photograph not found.")

    # =====================================================
    # PAGE 3 - REPAIR PRIORITY
    # =====================================================

    c.showPage()

    c.setFillColor(colors.HexColor("#17365D"))

    c.rect(
        0,
        height - 75,
        width,
        75,
        fill=1,
        stroke=0
    )

    c.setFillColor(colors.white)

    c.setFont("Helvetica-Bold", 17)

    c.drawCentredString(
        width / 2,
        height - 43,
        "REPAIR PRIORITY REPORT"
    )

    c.setFillColor(colors.black)

    y = height - 120

    y = draw_heading(
        c,
        "6. REPAIR PRIORITY BREAKDOWN",
        y
    )

    priority_items = [

        ("Total Priority Score", "total", "/ 100"),

        ("Severity Score", "severity", "/ 40"),

        ("Reports Merged Score", "reports", "/ 20"),

        ("Road Class Score", "road", "/ 20"),

        ("Days Unresolved Score", "days", "/ 20"),
    ]

    for label, key, suffix in priority_items:

        c.setFont("Helvetica-Bold", 10)

        c.drawString(
            50,
            y,
            label
        )

        c.setFont("Helvetica", 10)

        c.drawString(
            300,
            y,
            f"{(priority_breakdown or {}).get(key, 0)} {suffix}"
        )

        y -= 25

    y -= 30

    y = draw_heading(
        c,
        "7. REPAIR ASSIGNMENT",
        y
    )

    c.setFont("Helvetica", 10)

    c.drawString(
        50,
        y,
        f"Assigned crew: {crew}"
    )

    y -= 25

    c.drawString(
        50,
        y,
        f"Current ticket status: {status}"
    )

    y -= 50

    c.setFont("Helvetica-Bold", 11)

    c.drawString(
        50,
        y,
        "Generated by RoadFix Complaint Management System"
    )

    y -= 25

    c.setFont("Helvetica", 9)

    c.drawString(
        50,
        y,
        datetime.utcnow().strftime(
            "Generated: %d %b %Y %H:%M UTC"
        )
    )

    # =====================================================
    # FINISH PDF
    # =====================================================

    c.save()

    buffer.seek(0)

    return buffer

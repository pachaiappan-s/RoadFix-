
import os
from ultralytics import YOLO

# ------------------------------------------
# ROADFIX YOLO26 MODEL CONFIGURATION
# ------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(BASE_DIR, "best_yolo26.pt")

DETECTED_DIR = os.path.join(BASE_DIR, "detected")
os.makedirs(DETECTED_DIR, exist_ok=True)

if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(
        f"YOLO26 model not found: {MODEL_PATH}"
    )

# Load newly trained YOLO26 model
model = YOLO(MODEL_PATH)

print("================================")
print("RoadFix YOLO26 model loaded!")
print("Model classes:", model.names)
print("Detected images folder:", DETECTED_DIR)
print("================================")


def detect_damage(image_path):
    """Detect road damage and save an annotated image."""

    if not os.path.exists(image_path):
        raise FileNotFoundError(
            f"Image not found: {image_path}"
        )

    results = model.predict(
        source=image_path,
        conf=0.10,
        iou=0.30,
        imgsz=640,
        save=False,
        verbose=False
    )

    result = results[0]
    boxes = result.boxes

    if boxes is None or len(boxes) == 0:
        print("No road damage detected!")
        return None

    # Find the highest-confidence detection
    confidences = boxes.conf.cpu().numpy()
    best_index = int(confidences.argmax())

    best_confidence = float(confidences[best_index])

    # Get detected damage class
    class_id = int(boxes.cls[best_index].item())
    damage_type = model.names[class_id]

    # Get bounding box coordinates
    x1, y1, x2, y2 = boxes.xyxy[best_index].cpu().numpy()

    box_width = max(0, x2 - x1)
    box_height = max(0, y2 - y1)

    image_height, image_width = result.orig_shape

    # Calculate selected detection area percentage
    area_pct = (
        box_width * box_height /
        (image_width * image_height)
    ) * 100

    # ------------------------------------------
    # SAVE ANNOTATED DETECTION IMAGE
    # ------------------------------------------

    original_filename = os.path.basename(image_path)
    image_name = os.path.splitext(original_filename)[0]

    detected_filename = f"{image_name}_detected.jpg"

    detected_path = os.path.join(
        DETECTED_DIR,
        detected_filename
    )

    # Save image with all YOLO detection boxes
    result.save(filename=detected_path)

    print("========== YOLO26 DETECTION ==========")
    print("Damage type:", damage_type)
    print("Confidence:", best_confidence)
    print("Damage area:", area_pct, "%")
    print("Total detections:", len(boxes))
    print("Detected image saved:", detected_path)
    print("======================================")

    # Keep the same return structure for Flask compatibility
    return {
        "damage_type": str(damage_type).capitalize(),
        "confidence": best_confidence,
        "area_pct": float(area_pct),
        "detected_image": detected_filename
    }


def get_severity(area_pct):

    if area_pct >= 4:
        return "High"

    if area_pct >= 1.5:
        return "Medium"

    return "Low"

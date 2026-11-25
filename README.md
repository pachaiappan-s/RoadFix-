# RoadFix - AI-Based Road Damage Reporting and Management System



RoadFix is a web-based road damage reporting and management system. Citizens can submit pothole and road damage reports, while administrators can review and manage those reports.



## Features



- Citizen road damage reporting with images

- AI-based road damage detection using YOLO

- Admin dashboard for managing reports

- Ticket status tracking

- Road damage priority classification

- PDF work-order generation

- Email notifications when configured

- SQLite database



## Technologies



- Python

- Flask

- Flask-SQLAlchemy

- SQLite

- HTML, CSS, JavaScript

- Ultralytics YOLO



## Project Structure



    RoadFix/

    |-- backend/

    |   |-- app.py

    |   |-- ai_detector.py

    |   |-- best_yolo26.pt

    |   |-- database.py

    |   |-- email_utils.py

    |   |-- models.py

    |   |-- pdf_generator.py

    |   |-- priority.py

    |   |-- requirements.txt

    |   |-- seed.py

    |

    |-- frontend/

    |   |-- admin.html

    |   |-- admin.js

    |   |-- citizen.html

    |   |-- citizen.js

    |   |-- login.html

    |   |-- pipeline.js

    |   |-- style.css

    |   |-- theme.js

    |

    |-- .gitignore

    |-- LICENSE

    |-- README.md



## Installation



### 1. Clone the repository



    git clone https://github.com/pachaiappan-s/RoadFix-.git

    cd RoadFix-



### 2. Create a virtual environment



    python -m venv .venv



Activate it on Windows PowerShell:



    .venv\\Scripts\\Activate.ps1



### 3. Install dependencies



    pip install -r backend/requirements.txt



### 4. Configure environment variables



Before starting the application, configure the required environment variables in Windows PowerShell:



```powershell

$env:FLASK_SECRET_KEY = "replace-with-a-long-random-secret"

$env:ADMIN_USERNAME = "your-admin-username"

$env:ADMIN_PASSWORD = "your-secure-admin-password"

```



Optional email notification settings:



```powershell

$env:EMAIL_ADDRESS = "your-email-address"

$env:EMAIL_PASSWORD = "your-email-app-password"

```



These settings apply to the current PowerShell session. Configure them again if you open a new terminal.



**Security:** Never publish real passwords, email credentials, or secret keys.



### 5. Start the backend



    cd backend

    python app.py



Open the local address displayed by Flask in your browser.



## License



This project is licensed under the MIT License. See the LICENSE file for details.

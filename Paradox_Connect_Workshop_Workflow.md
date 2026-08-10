# Paradox Connect Workshop & Backend Team Workflow

## 1. Backend Teams (Super Admin Operations)
Super Admins (role = `super_admin`) have full CRUD control over the **Backend Teams** (`/backend_teams`). This allows them to create and assign roles (`super_admin`, `admin`, `volunteer`, etc.) and departments (`technicals`, `sports`, `culturals`, etc.). 

## 2. Workshops (Super Admin Operations)
Super Admins can also fully manage workshops:
- **Create/Update/Delete Workshops**: Manage workshop details including capacity, venue, and instructions.
- **Volunteer Assignment**: Assign volunteers (`workshop_team`) to specific workshops and explicitly toggle their scanning capabilities (`scanning_enabled`).
- **View Logs**: Monitor all live registrations, attendance, and on-spot scans in the workshop's `logs`.

## 3. Workshop Registration & Attendance

### Pre-Registration
- A participant can register for **one workshop per time slot** as long as it hasn't reached its max capacity.
- **Scanning (Pre-Registered)**:
  - Enabled exactly **30 minutes before** the workshop's start time and remains active for 1 hour.
  - The participant shows their unique encrypted profile QR to an assigned volunteer (who has scanning permissions).
  - The backend decrypts it, validates the timestamps, ensures the participant is registered, and marks them as **Attended**.

### On-Spot Registration
- If a participant missed registration or decided to attend a different workshop (even if they already registered for a different workshop in the same slot), they can attempt an **On-Spot Registration**.
- **Scanning (On-Spot)**:
  - Enabled **15 minutes before** the workshop starts and remains active for 1 hour.
  - Maximum on-spot attendees allowed is **10% of the total capacity** of the workshop.
  - The assigned volunteer selects the "On-Spot Scan" option in the scanner app.
  - Upon successful scan, the participant is instantly registered for the workshop and marked as **Attended**. 
  - *Note:* If the participant was pre-registered for a different workshop in that identical slot, the previous pre-registration is overridden (since a user cannot attend two workshops in the exact same slot).

### Logging
Every action—whether it's a pre-registration scan, an on-spot scan, or a general registration event—is meticulously logged inside the workshop's `logs` array for transparency and administrative auditing.

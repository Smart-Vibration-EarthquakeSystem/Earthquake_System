# 🌍 Smart Vibration & Earthquake Early Warning System

## 📌 Description

The **Smart Vibration & Earthquake Early Warning System** is an embedded and web-integrated solution designed to detect abnormal ground vibrations and provide real-time alerts to users. The system continuously monitors vibration levels using a sensor connected to a microcontroller and triggers immediate warnings through local alerts and a web-based dashboard.

This project aims to provide a **low-cost, reliable, and scalable early warning system** suitable for homes, schools, and small institutions where professional seismic systems are not available.

## 🎯 Objectives

* Detect abnormal ground vibrations in real-time
* Provide instant alerts using buzzer, LEDs, and LCD
* Enable remote monitoring through a web dashboard
* Ensure low-cost and easy deployment

## ⚙️ System Overview

The system consists of:

* A **hardware module** with a vibration sensor (SW-420) and ATmega328P microcontroller
* A **Wi-Fi communication module (ESP8266)** for transmitting data
* A **web-based dashboard** for real-time monitoring using Firebase

The microcontroller processes vibration data and sends it to the cloud, where it is visualized through a responsive web interface.

## 🚀 Features

* 📡 Real-time vibration detection
* 🔔 Instant audio-visual alerts (buzzer, LEDs, LCD)
* 🌐 Live monitoring via web dashboard
* 📊 Graphical visualization of vibration data
* 📁 Historical data tracking
* ⚡ Low-cost embedded system design

## 🛠 Technologies Used

* **Hardware:** ATmega328P, SW-420 Vibration Sensor, ESP8266
* **Embedded Programming:** C
* **Frontend:** HTML, CSS, JavaScript
* **Backend / Database:** Firebase Realtime Database
* **Communication:** UART, GPIO, HTTP APIs

## 📸 Demo

(Add screenshots or demo video link here)

## ⚙️ Setup Instructions

1. Clone the repository
2. Upload the firmware to the microcontroller
3. Configure ESP8266 Wi-Fi module
4. Set up Firebase configuration
5. Open the web dashboard (`index.html`)

## 🌐 Deploy the dashboard on Render

The folder `web-dashboard/` is a static site (HTML, CSS, JS). You can host it on [Render](https://render.com) for free.

### Option A — Blueprint (`render.yaml`)

1. Push this repository to GitHub (or GitLab / Bitbucket).
2. In Render: **New** → **Blueprint** → connect the repo → confirm the service from `render.yaml`.
3. Deploy. Your site will be at `https://<service-name>.onrender.com`.

### Option B — Static Site (dashboard UI)

1. **New** → **Static Site** → connect the repo.
2. **Root directory**: leave empty (repo root) or set **Publish directory** to `web-dashboard`.
3. **Build command**: leave empty (nothing to compile).
4. **Publish directory**: `web-dashboard` (path relative to repo root).

### Firebase

- Realtime Database rules must allow the reads your dashboard needs (same as when testing locally).
- If you use **Firebase Authentication**, add your Render hostname (e.g. `earthquake-monitor-dashboard.onrender.com`) under **Firebase Console → Project settings → Authorized domains**.

`firebase-init.js` in `web-dashboard` already contains your web app config; no Render env vars are required for Firebase client SDK usage.

## 👥 Team Members

* KUHANESAN D.
* PUGALINI M.
* THIPUSHANTH P.
* RATHINI R.
* YOGABALAN R.

## 💡 Future Improvements

* Integration with mobile app notifications
* Cloud-based data logging and analytics
* Machine learning for vibration pattern detection
* GPS-based earthquake location tracking

## 📄 License

This project is developed for academic purposes.

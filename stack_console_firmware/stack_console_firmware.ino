/*
  STACK Console — ESP32 Firmware
  --------------------------------
  Runs entirely on the ESP32:
    - Creates its own WiFi network (AP mode) — no router needed, just
      connect a phone/tablet directly to it.
    - Serves the whole static website (index.html, css/, js/, html/...)
      straight from the ESP32's LittleFS flash filesystem.
    - Exposes /data.json as a LIVE endpoint (built fresh on every
      request with ArduinoJson) containing pullPercent, reps,
      setTimeSeconds, and avgTempoSeconds — the same fields the
      website's JSON File mode already expects.

  Libraries needed (Library Manager):
    - ArduinoJson (by Benoit Blanchon) — v7 syntax used below
    - LittleFS is built into the ESP32 Arduino core, no install needed

  Before uploading:
    1. Put your site files (index.html, css/, js/, html/, icon.ico...)
       into a folder named "data" next to this .ino file.
    2. Upload them to the ESP32's flash using the LittleFS filesystem
       uploader for your IDE:
         - Arduino IDE: "ESP32 Sketch Data Upload" tool (via the
           arduino-littlefs-upload plugin — install it if you don't
           have it already, then Tools > ESP32 LittleFS Data Upload)
         - PlatformIO: `pio run --target uploadfs`
    3. Then upload this sketch normally.

  Wiring (ultrasonic sensor, same pins as the earlier demo sketch):
    TRIG -> GPIO 5
    ECHO -> GPIO 4
    (Remember the 5V/3.3V ECHO caveat from before if using a real HC-SR04.)
*/

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

// ---------- WiFi AP settings ----------
const char* AP_SSID     = "STACK-Console";
const char* AP_PASSWORD = "liftheavy";   // WPA2 needs 8+ chars; use "" for an open network

WebServer server(80);

// ---------- ultrasonic sensor ----------
const int TRIG_PIN = 5;
const int ECHO_PIN = 4;

// Calibrate these to your actual handle's travel distance.
// DIST_MIN_CM = sensor reading when the handle is fully pulled (closest).
// DIST_MAX_CM = sensor reading when the handle is fully released (farthest).
const float DIST_MIN_CM = 5.0;
const float DIST_MAX_CM = 40.0;

const unsigned long SENSOR_INTERVAL_MS = 60;   // don't trigger more often than this
unsigned long lastSensorReadMs = 0;

// ---------- rep detection state ----------
const float UP_THRESHOLD   = 85.0;   // pullPercent that counts as "fully pulled"
const float DOWN_THRESHOLD = 15.0;   // pullPercent that counts as "back down"

enum RepPhase { PHASE_DOWN, PHASE_UP };
RepPhase repPhase = PHASE_DOWN;

float currentPullPercent = 0;
int repCount = 0;
unsigned long setStartMs = 0;
unsigned long lastRepMs = 0;

const int TEMPO_WINDOW = 8;           // rolling average over the last N reps
float repDurations[TEMPO_WINDOW];
int repDurationCount = 0;
int repDurationIndex = 0;

// =========================================================
// Ultrasonic distance -> pull percentage
// =========================================================

// Returns distance in cm, or -1 if no echo was received (out of range /
// nothing reflecting the ping / wiring issue).
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout
  if (duration == 0) return -1;
  return (duration * 0.0343) / 2.0;
}

float distanceToPullPercent(float distanceCm) {
  float clamped = constrain(distanceCm, DIST_MIN_CM, DIST_MAX_CM);
  float pct = (DIST_MAX_CM - clamped) / (DIST_MAX_CM - DIST_MIN_CM) * 100.0;
  return constrain(pct, 0.0, 100.0);
}

// =========================================================
// Sensor + rep-counting update — call often from loop(), it
// rate-limits itself internally so it's safe to call every iteration
// =========================================================
void updateSensor() {
  unsigned long now = millis();
  if (now - lastSensorReadMs < SENSOR_INTERVAL_MS) return;
  lastSensorReadMs = now;

  float distance = readDistanceCm();
  if (distance < 0) return; // no echo this cycle — keep the last known value

  currentPullPercent = distanceToPullPercent(distance);

  // simple state machine: a rep completes once we've gone all the way
  // up past UP_THRESHOLD and back down past DOWN_THRESHOLD
  if (repPhase == PHASE_DOWN && currentPullPercent >= UP_THRESHOLD) {
    repPhase = PHASE_UP;
  } else if (repPhase == PHASE_UP && currentPullPercent <= DOWN_THRESHOLD) {
    repPhase = PHASE_DOWN;
    repCount++;

    unsigned long nowMs = millis();
    if (lastRepMs > 0) {
      float repSeconds = (nowMs - lastRepMs) / 1000.0;
      repDurations[repDurationIndex] = repSeconds;
      repDurationIndex = (repDurationIndex + 1) % TEMPO_WINDOW;
      if (repDurationCount < TEMPO_WINDOW) repDurationCount++;
    }
    lastRepMs = nowMs;
  }
}

float averageTempoSeconds() {
  if (repDurationCount == 0) return 0;
  float sum = 0;
  for (int i = 0; i < repDurationCount; i++) sum += repDurations[i];
  return sum / repDurationCount;
}

// =========================================================
// HTTP handlers
// =========================================================

// Live data endpoint — built fresh every request, not read from a file.
void handleDataJson() {
  JsonDocument doc; // ArduinoJson v7: auto-sized, no template capacity needed

  doc["pullPercent"] = currentPullPercent;
  doc["reps"] = repCount;
  doc["setTimeSeconds"] = (millis() - setStartMs) / 1000.0;
  doc["avgTempoSeconds"] = averageTempoSeconds();

  String output;
  serializeJson(doc, output);
  server.send(200, "application/json", output);
}

// Optional convenience endpoint to zero everything out for a fresh set —
// call this (e.g. POST /reset) from a "New Set" button if you add one.
void handleReset() {
  repCount = 0;
  repPhase = PHASE_DOWN;
  setStartMs = millis();
  lastRepMs = 0;
  repDurationCount = 0;
  repDurationIndex = 0;
  server.send(200, "application/json", "{\"status\":\"reset\"}");
}

String getContentType(const String& path) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css"))  return "text/css";
  if (path.endsWith(".js"))   return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".ico"))  return "image/x-icon";
  if (path.endsWith(".png"))  return "image/png";
  if (path.endsWith(".svg"))  return "image/svg+xml";
  return "text/plain";
}

// Serves any file that exists in LittleFS, e.g. /css/styles.css,
// /html/visualizer.html, or / (mapped to /index.html).
bool serveStaticFile(String path) {
  if (path.endsWith("/")) path += "index.html";
  if (!LittleFS.exists(path)) return false;

  File file = LittleFS.open(path, "r");
  if (!file) return false;
  server.streamFile(file, getContentType(path));
  file.close();
  return true;
}

void handleNotFound() {
  if (serveStaticFile(server.uri())) return;
  server.send(404, "text/plain", "404: Not Found — " + server.uri());
}

// =========================================================
// Setup / loop
// =========================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  if (!LittleFS.begin(true)) { // true = format if mount fails
    Serial.println("LittleFS mount failed — did you upload the data folder?");
  } else {
    Serial.println("LittleFS mounted.");
  }

  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("AP started. Connect to WiFi network: ");
  Serial.println(AP_SSID);
  Serial.print("Then visit: http://");
  Serial.println(WiFi.softAPIP()); // normally 192.168.4.1

  server.on("/data.json", HTTP_GET, handleDataJson);
  server.on("/reset", HTTP_POST, handleReset);
  server.onNotFound(handleNotFound); // serves every other file from LittleFS

  server.begin();
  setStartMs = millis();
}

void loop() {
  server.handleClient();
  updateSensor();
}

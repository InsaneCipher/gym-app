/*
  STACK Console — ESP32 Firmware (with debug logging)
  ------------------------------------------------------
  Same as before, but with Serial prints added at every stage so you
  can see exactly what's happening: WiFi/LittleFS setup, every file
  request, every sensor reading, every rep detected, and the JSON
  actually being sent out.

  Open the Serial Monitor at 115200 baud, then load the page and watch
  what prints (or doesn't). See the troubleshooting notes at the very
  bottom of this file for how to read the output.
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

const float DIST_MIN_CM = 5.0;
const float DIST_MAX_CM = 40.0;

const unsigned long SENSOR_INTERVAL_MS = 60;
unsigned long lastSensorReadMs = 0;

// set to false once things are working, to quiet down the sensor spam
bool DEBUG_SENSOR_READINGS = true;

// ---------- rep detection state ----------
const float UP_THRESHOLD   = 85.0;
const float DOWN_THRESHOLD = 15.0;

enum RepPhase { PHASE_DOWN, PHASE_UP };
RepPhase repPhase = PHASE_DOWN;

float currentPullPercent = 0;
int repCount = 0;
unsigned long setStartMs = 0;
unsigned long lastRepMs = 0;

const int TEMPO_WINDOW = 8;
float repDurations[TEMPO_WINDOW];
int repDurationCount = 0;
int repDurationIndex = 0;

// =========================================================
// Ultrasonic distance -> pull percentage
// =========================================================

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) {
    if (DEBUG_SENSOR_READINGS) Serial.println("[sensor] no echo (timeout) — check wiring/range");
    return -1;
  }
  return (duration * 0.0343) / 2.0;
}

float distanceToPullPercent(float distanceCm) {
  float clamped = constrain(distanceCm, DIST_MIN_CM, DIST_MAX_CM);
  float pct = (DIST_MAX_CM - clamped) / (DIST_MAX_CM - DIST_MIN_CM) * 100.0;
  return constrain(pct, 0.0, 100.0);
}

// =========================================================
// Sensor + rep-counting update
// =========================================================
void updateSensor() {
  unsigned long now = millis();
  if (now - lastSensorReadMs < SENSOR_INTERVAL_MS) return;
  lastSensorReadMs = now;

  float distance = readDistanceCm();
  if (distance < 0) return; // readDistanceCm() already logged the timeout

  currentPullPercent = distanceToPullPercent(distance);

  if (DEBUG_SENSOR_READINGS) {
    Serial.printf("[sensor] distance=%.1fcm  pullPercent=%.1f%%  phase=%s\n",
      distance, currentPullPercent, repPhase == PHASE_UP ? "UP" : "DOWN");
  }

  if (repPhase == PHASE_DOWN && currentPullPercent >= UP_THRESHOLD) {
    repPhase = PHASE_UP;
    Serial.println("[rep] phase -> UP (crossed upper threshold)");
  } else if (repPhase == PHASE_UP && currentPullPercent <= DOWN_THRESHOLD) {
    repPhase = PHASE_DOWN;
    repCount++;

    unsigned long nowMs = millis();
    float repSeconds = 0;
    if (lastRepMs > 0) {
      repSeconds = (nowMs - lastRepMs) / 1000.0;
      repDurations[repDurationIndex] = repSeconds;
      repDurationIndex = (repDurationIndex + 1) % TEMPO_WINDOW;
      if (repDurationCount < TEMPO_WINDOW) repDurationCount++;
    }
    lastRepMs = nowMs;

    Serial.printf("[rep] *** REP COMPLETE *** total=%d  duration=%.2fs\n", repCount, repSeconds);
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

void handleDataJson() {
  JsonDocument doc;

  doc["pullPercent"] = currentPullPercent;
  doc["reps"] = repCount;
  doc["setTimeSeconds"] = (millis() - setStartMs) / 1000.0;
  doc["avgTempoSeconds"] = averageTempoSeconds();

  String output;
  serializeJson(doc, output);

  Serial.print("[http] GET /data.json from ");
  Serial.print(server.client().remoteIP());
  Serial.print("  -> ");
  Serial.println(output);

  server.send(200, "application/json", output);
}

void handleReset() {
  repCount = 0;
  repPhase = PHASE_DOWN;
  setStartMs = millis();
  lastRepMs = 0;
  repDurationCount = 0;
  repDurationIndex = 0;
  Serial.println("[http] POST /reset — counters zeroed");
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

bool serveStaticFile(String path) {
  if (path.endsWith("/")) path += "index.html";

  bool exists = LittleFS.exists(path);
  Serial.print("[http] GET ");
  Serial.print(path);
  Serial.print("  exists=");
  Serial.print(exists ? "yes" : "NO");

  if (!exists) {
    Serial.println();
    return false;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    Serial.println("  -> LittleFS.open() FAILED even though exists() was true");
    return false;
  }

  Serial.printf("  -> serving %u bytes as %s\n", (unsigned)file.size(), getContentType(path).c_str());
  server.streamFile(file, getContentType(path));
  file.close();
  return true;
}

void handleNotFound() {
  if (serveStaticFile(server.uri())) return;
  Serial.print("[http] 404: ");
  Serial.println(server.uri());
  server.send(404, "text/plain", "404: Not Found — " + server.uri());
}

// lists every file LittleFS actually has, so you can confirm the
// upload worked and the paths are what you expect
void listLittleFSFiles() {
  Serial.println("[littlefs] Files found:");
  File root = LittleFS.open("/");
  if (!root || !root.isDirectory()) {
    Serial.println("[littlefs]   (could not open root directory)");
    return;
  }
  File f = root.openNextFile();
  int count = 0;
  while (f) {
    Serial.printf("[littlefs]   %s  (%u bytes)\n", f.path(), (unsigned)f.size());
    count++;
    f = root.openNextFile();
  }
  if (count == 0) {
    Serial.println("[littlefs]   ** NO FILES FOUND ** — did the LittleFS data upload actually run?");
  } else {
    Serial.printf("[littlefs] %d file(s) total\n", count);
  }
}

// =========================================================
// Setup / loop
// =========================================================

void setup() {
  Serial.begin(115200);
  delay(1000); // extra time for USB CDC to enumerate before we print anything
  Serial.println();
  Serial.println("===== STACK Console booting =====");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Serial.println("[littlefs] mounting...");
  if (!LittleFS.begin(true)) {
    Serial.println("[littlefs] MOUNT FAILED — did you upload the data folder?");
  } else {
    Serial.println("[littlefs] mounted OK");
    Serial.printf("[littlefs] used=%u / total=%u bytes\n", LittleFS.usedBytes(), LittleFS.totalBytes());
    listLittleFSFiles();
  }

  Serial.print("[wifi] starting AP \"");
  Serial.print(AP_SSID);
  Serial.println("\"...");
  bool apOk = WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.println(apOk ? "[wifi] AP started OK" : "[wifi] AP START FAILED");
  Serial.print("[wifi] connect to that network, then visit: http://");
  Serial.println(WiFi.softAPIP());

  server.on("/data.json", HTTP_GET, handleDataJson);
  server.on("/reset", HTTP_POST, handleReset);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("[http] server started on port 80");

  setStartMs = millis();
  Serial.println("===== Setup complete — waiting for requests =====");
  Serial.println();
}

void loop() {
  server.handleClient();
  updateSensor();
}

/*
  ===== Reading the debug output =====

  On boot you should see, in order:
    [littlefs] mounted OK
    [littlefs] ... a list of your actual files (index.html, css/styles.css, etc.)
    [wifi] AP started OK
    [wifi] connect to that network, then visit: http://192.168.4.1

  If "[littlefs] ** NO FILES FOUND **" prints:
    The LittleFS data upload never actually happened, or uploaded to
    the wrong partition. Re-run the LittleFS upload tool and watch
    its own console output for errors — this is the single most
    common cause of "page loads but is broken."

  Once the page is open in a browser, every request should print a
  line starting with [http]. If you open the site and see NOTHING
  print at all:
    You're likely not actually talking to the ESP32 — double check
    the phone/laptop is connected to the "STACK-Console" WiFi network
    (not still on your home WiFi), and that the address bar shows
    192.168.4.1 (or whatever [wifi] printed).

  If you see [http] GET /index.html etc. but NEVER see
  [http] GET /data.json:
    The website itself isn't calling this endpoint — check that
    fetch() in your JS points to "data.json" or "/data.json" (not
    "../data.json" or some other relative path that no longer
    resolves once served from the ESP32's root), and that the page is
    actually in "JSON File" mode rather than "Simulated" mode if your
    UI has that toggle.

  If [http] GET /data.json DOES appear, but the JSON payload printed
  after "->" always shows pullPercent=0 and reps=0:
    The HTTP side is fully working — the problem is upstream, in the
    sensor. Check for repeating "[sensor] no echo (timeout)" lines,
    which point to a wiring issue (TRIG/ECHO swapped, no common
    ground, sensor out of its usable range) rather than anything in
    the web server code.
*/
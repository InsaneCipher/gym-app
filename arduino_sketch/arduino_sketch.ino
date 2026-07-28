/*
  Ultrasonic Distance Demo — ESP32-S3-N16R8
  ------------------------------------------
  Reads an HC-SR04-style ultrasonic sensor and prints the measured
  distance (in cm and inches) to the Serial Monitor.

  Wiring:
    TRIG -> GPIO 5
    ECHO -> GPIO 4
    VCC  -> 5V (or 3.3V if your sensor module supports it)
    GND  -> GND

  Note: the HC-SR04's ECHO pin outputs a 5V signal. Most ESP32-S3
  GPIOs are NOT 5V tolerant, so if your sensor is a genuine 5V HC-SR04,
  use a simple voltage divider (e.g. 1k/2k resistors) or a logic-level
  shifter between ECHO and GPIO 4 to protect the board. Many cheap
  "3.3V compatible" HC-SR04 clones skip this — check your specific
  module before wiring it directly.
*/

const int TRIG_PIN = 5;
const int ECHO_PIN = 4;

// Speed of sound ~343 m/s at room temperature -> 0.0343 cm/us.
// Dividing by 2 accounts for the round trip (out and back).
const float SOUND_SPEED_CM_PER_US = 0.0343;

void setup() {
  Serial.begin(115200);
  delay(500); // give the Serial Monitor a moment to connect

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Serial.println("Ultrasonic sensor demo starting...");
}

void loop() {
  // Send a 10us HIGH pulse on TRIG to start a measurement
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // pulseIn waits for ECHO to go HIGH, then times how long it stays HIGH.
  // A 30ms timeout avoids the sketch hanging if no echo is received
  // (e.g. nothing in range, or a wiring issue).
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    Serial.println("No echo received (out of range or check wiring)");
  } else {
    float distanceCm = (duration * SOUND_SPEED_CM_PER_US) / 2.0;

    Serial.print("Distance: ");
    Serial.print(distanceCm, 1);
    Serial.println(" cm");
  }

  delay(250); // ~4 readings per second
}
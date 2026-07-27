import json
import time
import math

def run_sensor_sim(path='sensor.json', interval=0.05, cycle_seconds=2.4):
    """Writes just the raw pull percentage, exactly like the real ESP32
    eventually will. Nothing about reps, weight, or timing lives here —
    a real sensor only knows 'how far is the handle pulled right now'."""
    start = time.time()
    while True:
        elapsed = time.time() - start
        phase = (elapsed % cycle_seconds) / cycle_seconds
        pull_percent = (1 - math.cos(phase * 2 * math.pi)) / 2 * 100

        with open(path, "w") as f:
            json.dump({"pullPercent": round(pull_percent, 1)}, f)

        time.sleep(interval)

if __name__ == '__main__':
    run_sensor_sim()
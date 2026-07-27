from flask import Flask
import threading
import webbrowser
import json
import time

app = Flask(__name__, static_folder='.', static_url_path='')

@app.route('/')
def index():
    return app.send_static_file('index.html')

# rep-detection thresholds — a rep counts once the sensor has gone
# above UP_THRESHOLD and then back below DOWN_THRESHOLD. This is a
# state machine, not a fixed cycle time, so it works with genuinely
# irregular real sensor input, not just a smooth synthetic wave.
UP_THRESHOLD = 85
DOWN_THRESHOLD = 15

def compute_from_sensor(sensor_path='sensor.json', output_path='data.json', poll_interval=0.05):
    reps = 0
    phase = "down"  # "down" -> "up" -> "down" completes one rep
    start_time = time.time()
    last_rep_time = start_time
    rep_durations = []

    while True:
        try:
            with open(sensor_path) as f:
                sensor = json.load(f)
            pull_percent = sensor.get("pullPercent", 0)
        except (FileNotFoundError, json.JSONDecodeError):
            # sensor file not written yet, or mid-write — just skip this tick
            time.sleep(poll_interval)
            continue

        if phase == "down" and pull_percent >= UP_THRESHOLD:
            phase = "up"
        elif phase == "up" and pull_percent <= DOWN_THRESHOLD:
            phase = "down"
            reps += 1
            now = time.time()
            rep_durations.append(now - last_rep_time)
            last_rep_time = now
            if len(rep_durations) > 8:
                rep_durations.pop(0)

        elapsed = time.time() - start_time
        avg_tempo = sum(rep_durations) / len(rep_durations) if rep_durations else 0

        data = {
            "pullPercent": pull_percent,
            "reps": reps,
            "setTimeSeconds": round(elapsed, 1),
            "avgTempoSeconds": round(avg_tempo, 1),
        }
        with open(output_path, "w") as f:
            json.dump(data, f)

        time.sleep(poll_interval)

if __name__ == '__main__':
    threading.Thread(target=compute_from_sensor, daemon=True).start()
    webbrowser.open("http://127.0.0.1:5000/index.html")
    app.run()
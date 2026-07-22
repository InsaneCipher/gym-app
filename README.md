# STACK

A lightweight web console for a home multi-gym setup. Load a handle, start a set, and watch your weight, pull distance, and rep count update live on any phone or tablet screen — no app install required.

## Features
- **Lift Visualizer** — animated weight stack, range-of-motion track, and rep counter for whatever handle is loaded
- Handle selector (Lat Pulldown, Seated Row, Chest Press, Leg Extension, Shoulder Press)
- Mobile-first layout designed to fit on one screen with no scrolling, so it's easy to glance at mid-set
- Toggle between simulated demo data and live data read from a JSON file (for testing before the hardware side is wired up)

## Status
Currently uses simulated or file-based data for development. Future versions will read live data directly from the gym's Bluetooth-enabled sensor via an ESP32 bridge.

## Running locally
This is a static site — clone the repo and open `index.html`, or serve it with a local server (e.g. `python3 -m http.server`) if you want to test the JSON data-source mode, since `fetch()` requires `http://` rather than `file://`.
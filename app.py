"""AETHER - web dashboard for the Mini Ambulance Route Assistant.

Run:   python app.py
Open:  http://127.0.0.1:5000

The browser only draws results. Every number comes from the Python algorithm
modules through pipeline.py.
"""
import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from pipeline import ScenarioError, config, resolve_scenario, simulate

app = Flask(__name__)
app.json.sort_keys = False


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def api_config():
    return jsonify(config())


@app.post("/api/simulate")
def api_simulate():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify(error="Request body must be valid JSON."), 400
    try:
        scenario = resolve_scenario(payload)
    except ScenarioError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(simulate(scenario))


@app.errorhandler(HTTPException)
def http_error(exc):
    if request.path.startswith("/api/"):
        return jsonify(error=exc.description), exc.code
    return exc


@app.errorhandler(Exception)
def unexpected_error(exc):
    app.logger.exception("Simulation failed")
    return jsonify(error="The simulation failed on the server. See the terminal for details."), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"AETHER is running. Open http://127.0.0.1:{port} in your browser. Press Ctrl+C to stop.")
    app.run(host="127.0.0.1", port=port, debug=False)

# AETHER — AI-Powered Ambulance Route Optimization System

AI Fundamentals final project. A simulated ambulance must reach the hospital as fast as possible,
but the shortest road may be blocked. AETHER plans a route, estimates how likely the road is blocked,
and decides whether to drive on or take the detour. Results are shown in a web dashboard.

> **Simulation only.** The city map, probabilities and rewards are invented for a toy model.
> AETHER uses no real-time or historical traffic data and is not connected to any dispatch service.

## Install (Windows)

1. Install Python 3.10 or newer from python.org. Tick **"Add python.exe to PATH"** during setup.
2. Open the project folder in File Explorer, click the address bar, type `cmd` and press Enter.
3. Install Flask (once):

```bash
python -m pip install -r requirements.txt
```

## Run the website

```bash
python app.py
```

Then open <http://127.0.0.1:5000> in a browser. Keep the terminal window open while you use the site.
Press `Ctrl+C` in the terminal to stop it.

If port 5000 is busy, choose another one first: `set PORT=5050` and then `python app.py`.

## Run the original console program

```bash
python main.py
```

Use `python main.py calm` or `python main.py mixed` for the other scenarios.

## Run the tests

```bash
python -m unittest -v
```

27 tests: each algorithm against hand-computed values, the three scenarios, a check that the website
returns exactly the same results as the console program, and the web API including bad input.

## Using the dashboard

1. Pick a scenario: **Rush hour**, **Quiet night** or **Jam history, silent sensor**.
   Changing a speed report or the sensor switches to **Custom**, which is computed live by the backend.
2. Press **Run simulation**. The five stages run in order and the map updates.
3. Click any map cell to inspect it. **Reset** clears the run.
4. Use the sidebar for **Algorithms**, **Data flow**, **Assumptions** and **Project info**.

## How the algorithms work together

| Stage | Algorithm (course topic) | Input | Output passed on |
|------|--------------------------|-------|------------------|
| 1 | **A\*** (informed search) | 6×6 map, start, hospital | Fastest route (5 min), detour (15 min), turn-back cost (19 min) |
| 2 | **Viterbi on an HMM** (reasoning over time) | Three speed reports from the risky road | Current traffic state, which sets the prior P(Blocked) |
| 3 | **Bayes' rule** (probabilistic reasoning) | Prior from stage 2 + one sensor reading | Posterior P(Blocked) |
| 4 | **MDP, one Bellman update** (sequential decisions) | P(Blocked) from stage 3 + travel times from stage 1 | Continue or Reroute |
| 5 | **A\*** again | The MDP's decision | Final route |

The MDP's rewards are the A\* travel times, its belief is the Bayes posterior, the Bayes prior comes
from Viterbi, and the MDP's decision triggers the A\* re-plan.

## Results

| Scenario | Speed reports | Sensor | P(Blocked) | Continue | Reroute | Decision |
|----------|---------------|--------|-----------:|---------:|--------:|----------|
| Rush hour (`rush`) | fast, slow, slow | alert    | 0.857 | -16.00 | -15.00 | Reroute (15 min) |
| Quiet night (`calm`) | fast, fast, fast | no alert | 0.012 |  -6.54 | -15.00 | Continue (5 min) |
| Jam history, silent sensor (`mixed`) | slow, slow, slow | no alert | 0.069 |  -7.17 | -15.00 | Continue (5 min) |

The agent reroutes only when P(Blocked) is above about 0.77. The rush-hour decision is close
(1 minute), which shows the model is sensitive to the assumed numbers.

## The algorithms

### A* search (`astar.py`)
- **How:** keeps a priority queue of cells ordered by `f = g + h`, where `g` is minutes driven so far
  and `h` is the Manhattan distance to the hospital. It always expands the lowest `f`.
- **Why here:** Manhattan distance never overestimates on a 4-direction grid, so A\* returns the
  shortest route while expanding fewer cells than BFS.

### Viterbi (`viterbi.py`)
- **How:** for each time step and each hidden state it stores the probability of the best state
  sequence ending there, then backtracks from the best final state.
- **Why here:** traffic (Flowing/Jammed) cannot be seen directly, only noisy speed reports, and it
  tends to persist over time. That is a hidden Markov model.

### Bayes' rule (`bayes.py`)
- **How:** `P(Blocked | obs) = P(obs | Blocked) * P(Blocked) / P(obs)`.
- **Why here:** the sensor gives false alarms (10%) and misses (10%), so one reading should update
  the belief instead of being trusted blindly.

### MDP (`mdp.py`)
- **How:** states {Clear, Blocked}, actions {Continue, Reroute}, reward = minus minutes.
  One Bellman update gives `Q(s,a) = sum T(s'|s,a) * [R(a,s') + gamma * V(s')]` with `V = 0`
  (so `gamma` has no effect in this one-step version). The Q-values are then weighted by the belief from Bayes.
- **Why here:** driving on has an uncertain outcome (5 min if clear, 19 min if blocked), so the
  agent must compare expected values rather than best cases.

## Project structure

```
astar.py, viterbi.py, bayes.py, mdp.py   the four algorithms (unchanged by the website)
main.py                                  console program, scenarios and all assumed numbers
pipeline.py                              runs the same five stages and returns the results as data
app.py                                   Flask server: the page, /api/config and /api/simulate
templates/index.html                     page structure
static/style.css, static/app.js          design and interaction (draws backend results only)
test_project.py, test_web.py             tests
requirements.txt                         Flask
```

## Web API

- `GET /api/config` returns the map, scenarios and every assumed value.
- `POST /api/simulate` with `{"scenario": "rush"}` (or `calm`, `mixed`) runs the pipeline.
  A custom run uses `{"custom": {"speeds": ["fast", "slow", "slow"], "alert": true}}`.
  Invalid input returns status 400 with an `error` message.

## Limitations and possible improvements

- Only one road is uncertain; a real city needs a belief for every road.
- The numbers are invented; they could be learned from real traffic data (classical ML).
- The MDP looks one step ahead; value iteration over the whole trip would allow re-deciding at every cell.
- Repeated sensor readings could be combined over time with the HMM forward algorithm.
- The Flask server is the built-in development server, meant for local demonstration only.

## AI assistance

The code was written with help from Claude (Anthropic). Every function is short and commented, and
each stage shows its intermediate numbers so they can be re-derived by hand and explained.

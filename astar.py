"""A* search on a small city grid (topic: informed search).

Grid symbols:  '.' free road   '#' permanently closed   'S' start   'H' hospital
Each move (up/down/left/right) costs 1 minute.
"""
import heapq


def manhattan(a, b):
    """Heuristic h(n): grid distance ignoring walls. Never overestimates, so A* stays optimal."""
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def find(grid, symbol):
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == symbol:
                return (r, c)
    raise ValueError(f"symbol {symbol!r} not on the grid")


def astar(grid, start, goal, extra_blocked=()):
    """Return (path, expanded_count). path is a list of (row, col) or None if no route.

    extra_blocked: cells to treat as closed in addition to '#' cells
    (used when the agent decides a road is blocked and re-plans).
    """
    rows, cols = len(grid), len(grid[0])
    blocked = set(extra_blocked)

    # Frontier entries: (f = g + h, g, cell). heapq always pops the smallest f.
    frontier = [(manhattan(start, goal), 0, start)]
    came_from = {start: None}
    best_g = {start: 0}
    expanded = 0

    while frontier:
        f, g, cell = heapq.heappop(frontier)
        if g > best_g[cell]:
            continue  # an older, worse entry for this cell
        expanded += 1

        if cell == goal:
            path = []
            while cell is not None:
                path.append(cell)
                cell = came_from[cell]
            return path[::-1], expanded

        r, c = cell
        for nxt in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            nr, nc = nxt
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            if grid[nr][nc] == "#" or nxt in blocked:
                continue
            new_g = g + 1
            if new_g < best_g.get(nxt, float("inf")):
                best_g[nxt] = new_g
                came_from[nxt] = cell
                heapq.heappush(frontier, (new_g + manhattan(nxt, goal), new_g, nxt))

    return None, expanded


def draw(grid, path=(), marks=None):
    """Return the grid as text with the route drawn as '*'. marks: {cell: char} overrides."""
    marks = marks or {}
    on_path = set(path)
    lines = []
    for r, row in enumerate(grid):
        out = []
        for c, ch in enumerate(row):
            cell = (r, c)
            if cell in marks:
                out.append(marks[cell])
            elif ch in "SH#":
                out.append(ch)
            elif cell in on_path:
                out.append("*")
            else:
                out.append(".")
        lines.append("    " + " ".join(out))
    return "\n".join(lines)

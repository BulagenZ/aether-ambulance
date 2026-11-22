"""Breadth-first search (topic: uninformed search).

Not part of the decision pipeline. It is a baseline: running BFS on the same map
shows how many cells A*'s heuristic saves while finding a route of the same length.
"""
from collections import deque


def bfs(grid, start, goal, extra_blocked=(), trace=None):
    """Return (path, expanded_count), like astar(). path is None if there is no route.

    trace: optional list; if given, every expanded cell is appended in expansion order.
    """
    rows, cols = len(grid), len(grid[0])
    blocked = set(extra_blocked)

    frontier = deque([start])          # first in, first out: nearest cells first
    came_from = {start: None}
    expanded = 0

    while frontier:
        cell = frontier.popleft()
        expanded += 1
        if trace is not None:
            trace.append(cell)

        if cell == goal:
            path = []
            while cell is not None:
                path.append(cell)
                cell = came_from[cell]
            return path[::-1], expanded

        r, c = cell
        for nxt in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):   # same order as A*
            nr, nc = nxt
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            if grid[nr][nc] == "#" or nxt in blocked or nxt in came_from:
                continue
            came_from[nxt] = cell
            frontier.append(nxt)

    return None, expanded

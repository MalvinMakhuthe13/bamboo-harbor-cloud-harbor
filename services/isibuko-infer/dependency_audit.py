"""Static import audit. Does not import the checkout and does not run a model."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

RUNNER_ROOTS = (
    "fashn_vton.tryon_mmdit",
    "fashn_vton.utils",
    "fashn_vton.dwpose",
    "fashn_vton.preprocessing.transforms",
)

PARSER_TOKENS = ("fashn_human_parser", "FashnHumanParser")


def _module_name(root: Path, path: Path) -> str:
    rel = path.relative_to(root).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _imports(path: Path, module: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parent = module.rsplit(".", 1)[0] if path.name != "__init__.py" else module
                parts = parent.split(".")
                if node.level > 1:
                    parts = parts[: 1 - node.level]
                prefix = ".".join(parts)
                found.append(f"{prefix}.{node.module}" if node.module else prefix)
            elif node.module:
                found.append(node.module)
    return found


def audit_checkout(root: Path) -> dict[str, Any]:
    src = root / "src"
    files = sorted(src.rglob("*.py")) if src.is_dir() else []
    if not files:
        return {
            "ok": False,
            "code": "CHECKOUT_MISSING",
            "parserReachableFromRunner": None,
            "parserReachableFromPackage": None,
            "message": "No Python checkout to audit. The model was not imported.",
        }
    modules = {_module_name(src, path): path for path in files}
    edges = {name: _imports(path, name) for name, path in modules.items()}

    def reachable(starts: tuple[str, ...]) -> set[str]:
        seen: set[str] = set()
        stack = [name for name in starts if name in modules]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            for target in edges.get(current, []):
                if target in modules and target not in seen:
                    stack.append(target)
        return seen

    runner = reachable(RUNNER_ROOTS)
    package = reachable(("fashn_vton",))
    parser_files = [
        str(path.relative_to(root))
        for path in files
        if any(token in path.read_text(encoding="utf-8", errors="replace") for token in PARSER_TOKENS)
    ]
    third_party = sorted(
        {
            item.split(".")[0]
            for name in runner
            for item in edges.get(name, [])
            if item not in modules and not item.startswith("fashn_vton")
        }
    )
    runner_hits_parser = any(name in runner for name in ("fashn_vton.pipeline", "fashn_vton.preprocessing.agnostic"))
    return {
        "ok": not runner_hits_parser,
        "code": "PARSER_NOT_IN_RUNNER_GRAPH" if not runner_hits_parser else "PARSER_IN_RUNNER_GRAPH",
        "parserReachableFromRunner": runner_hits_parser,
        "parserReachableFromPackage": "fashn_vton.pipeline" in package or "fashn_vton.preprocessing.agnostic" in package,
        "parserFiles": parser_files,
        "runnerModules": sorted(runner),
        "thirdPartyImports": third_party,
        "executed": False,
        "message": "Static audit only. No module was imported and no image was generated.",
    }

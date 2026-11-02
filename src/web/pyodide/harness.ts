// SEC: runs inside the Pyodide worker. The import policy is a usability contract the learner can bypass, because the code runs on their machine. The worker still blocks network APIs and is terminated on time or memory.
// INV: run_payload reads one JSON string and returns one result object. Hidden tests run in a shallow copy of the learner namespace. guardDefs false skips the dunder-definition ban so a reference solution can be checked.
export const HARNESS_PY: string = String.raw`
import ast, builtins, io, json, sys

DENY_ROOTS = frozenset({"js", "pyodide", "micropip"})
BANNED_NAMES = frozenset({"__import__", "eval", "exec", "compile", "open", "input", "breakpoint", "globals", "locals", "vars", "getattr", "setattr", "delattr", "help", "exit", "quit", "memoryview", "copyright", "credits", "license", "js", "pyodide", "micropip"})
BANNED_ATTRS = frozenset({
    "sys", "os", "posix", "nt", "subprocess", "builtins", "importlib", "ctypes", "ctypeslib", "socket", "shutil", "pathlib", "inspect", "gc", "marshal",
    "pickle", "runpy", "threading", "multiprocessing", "concurrent", "asyncio", "signal", "resource", "selectors", "mmap", "fcntl", "pty", "tempfile", "glob",
    "zipimport", "pkgutil", "site", "sysconfig", "linecache", "traceback", "weakref", "atexit", "faulthandler", "tracemalloc", "http", "urllib", "ssl",
    "webbrowser", "platform", "shlex", "f2py", "distutils", "modules", "load_library", "f_globals", "f_locals", "f_builtins", "f_back", "f_code", "tb_frame",
    "tb_next", "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code", "co_code", "js", "pyodide", "micropip", "ffi",
})
CAP = 16000

class PolicyError(Exception):
    pass

def run_payload(raw):
    _p = json.loads(raw)
    allowed = frozenset(_p["libs"]) - DENY_ROOTS
    available = ", ".join(sorted(allowed)) or "none"

    def _deny(line, what):
        raise PolicyError("line %d: %s is not allowed here. Available libraries: %s. Installing packages is disabled." % (line, what, available))

    def _check(src, fname, guard=False):
        tree = ast.parse(src, fname)
        for n in ast.walk(tree):
            line = getattr(n, "lineno", 0)
            if isinstance(n, ast.Import):
                for a in n.names:
                    root = a.name.split(".")[0]
                    if root in DENY_ROOTS or root not in allowed or any(p.startswith("_") or p in BANNED_ATTRS for p in a.name.split(".")[1:]):
                        _deny(line, "importing '%s'" % a.name)
            elif isinstance(n, ast.ImportFrom):
                mod = n.module or ""
                if n.level or mod.split(".")[0] in DENY_ROOTS or mod.split(".")[0] not in allowed or any(p.startswith("_") or p in BANNED_ATTRS for p in mod.split(".")[1:]):
                    _deny(line, "importing from '%s'" % ("." * n.level + mod))
                for a in n.names:
                    if a.name == "*" or a.name.startswith("_") or a.name in BANNED_ATTRS:
                        _deny(line, "importing '%s' from '%s'" % (a.name, mod))
            elif isinstance(n, ast.Name):
                if n.id in BANNED_NAMES or n.id.startswith("__"):
                    _deny(line, "'%s'" % n.id)
            elif isinstance(n, ast.Attribute):
                if n.attr.startswith("_") or n.attr in BANNED_ATTRS:
                    _deny(line, "the attribute '.%s'" % n.attr)
            elif isinstance(n, ast.MatchClass):
                for k in n.kwd_attrs:
                    if k.startswith("_") or k in BANNED_ATTRS:
                        _deny(line, "matching on '%s'" % k)
            elif isinstance(n, ast.alias) and n.asname and n.asname.startswith("__"):
                _deny(line, "the name '%s'" % n.asname)
            elif guard and isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name.startswith("__"):
                _deny(line, "the name '%s'" % n.name)
        return compile(tree, fname, "exec")

    _real_import = builtins.__import__

    def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        caller = globals.get("__name__") if isinstance(globals, dict) else None
        trusted = isinstance(caller, str) and caller not in ("__learner__", "__main__", "builtins")
        root = name.split(".")[0]
        if root in DENY_ROOTS or (not trusted and (level != 0 or root not in allowed)):
            raise ImportError("import of '%s' is not allowed. Available libraries: %s. Installing packages is disabled." % (name, available))
        return _real_import(name, globals, locals, fromlist, level)

    class _Finder:
        def find_spec(self, name, path, target=None):
            root = name.split(".")[0]
            if root not in DENY_ROOTS and root in allowed:
                return None
            frame = sys._getframe(1)
            while frame is not None:
                mod = frame.f_globals.get("__name__", "")
                if not isinstance(mod, str) or mod.startswith("importlib") or mod.startswith("_frozen_importlib"):
                    frame = frame.f_back
                    continue
                if root in DENY_ROOTS or mod in ("__learner__", "__main__", "builtins"):
                    raise ImportError("import of '%s' is not allowed. Available libraries: %s. Installing packages is disabled." % (name, available))
                return None
            return None

    _safe = {k: v for k, v in vars(builtins).items() if k not in BANNED_NAMES and not k.startswith("_")}
    _safe["__build_class__"] = builtins.__build_class__
    _safe["__import__"] = _guarded_import
    builtins.__import__ = _guarded_import
    sys.meta_path.insert(0, _Finder())
    for _m in ("js", "micropip", "pyodide.http", "pyodide.ffi"):
        sys.modules.pop(_m, None)

    class _Cap(io.TextIOBase):
        def __init__(self):
            self.parts = []
            self.n = 0
        def writable(self):
            return True
        def write(self, t):
            t = str(t)
            if self.n < CAP:
                self.parts.append(t[: CAP - self.n])
            self.n += len(t)
            return len(t)
        def text(self):
            return "".join(self.parts) + ("\n[output truncated]" if self.n > CAP else "")

    def _describe(e, fname):
        if isinstance(e, PolicyError):
            return str(e)
        if isinstance(e, SyntaxError) and e.filename == fname:
            return "line %s: SyntaxError: %s" % (e.lineno, e.msg)
        line = None
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == fname:
                line = tb.tb_lineno
            tb = tb.tb_next
        msg = "%s: %s" % (type(e).__name__, e) if str(e) else type(e).__name__
        return ("line %d: %s" % (line, msg) if line else msg)[:2000]

    _ns = {"__name__": "__learner__", "__builtins__": _safe}
    _so, _se = _Cap(), _Cap()
    _error = None
    _results = []
    _out, _err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _so, _se
    try:
        try:
            exec(_check(_p["code"], "<learner>", bool(_p.get("guardDefs", True))), _ns)
        except BaseException as e:
            _error = _describe(e, "<learner>")
        for t in _p["tests"]:
            if _error is not None:
                _results.append({"name": t["name"], "passed": False, "error": "not run: your code raised an error"})
                continue
            try:
                exec(_check(t["code"], "<test>"), dict(_ns))
                _results.append({"name": t["name"], "passed": True, "error": None})
            except BaseException as e:
                _results.append({"name": t["name"], "passed": False, "error": _describe(e, "<test>")})
    finally:
        sys.stdout, sys.stderr = _out, _err
    return {"stdout": _so.text(), "stderr": _se.text(), "error": _error, "tests": _results}
`;

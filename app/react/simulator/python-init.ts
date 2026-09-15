export const PY_INIT = `
import json, sys, traceback
sys.path.insert(0, "/kilnsrc")
from kiln.webapp import KilnApp

_app = KilnApp()

def _call(name, payload):
    """UI가 부르는 유일한 경계. 계산은 kiln 패키지가 한다."""
    try:
        spec = json.loads(payload)
        fn = getattr(_app, name)
        value = fn(*spec.get("args", []), **spec.get("kwargs", {}))
        return json.dumps({"ok": True, "value": value}, ensure_ascii=False, default=str)
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"{type(exc).__name__}: {exc}",
             "trace": traceback.format_exc()},
            ensure_ascii=False,
        )
`;

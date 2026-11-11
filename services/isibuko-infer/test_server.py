import json
import os
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import server


def test_missing_weights_do_not_generate():
    os.environ["ISIBUKO_WEIGHTS"] = "/tmp/isibuko-weights-absent"
    os.environ.pop("ISIBUKO_ALLOW_FASHN", None)
    body = server.assess()
    assert body["generated"] is False
    assert body["image"] is None
    assert body["code"] == "WEIGHTS_MISSING"
    assert body["ok"] is False


def test_http_status_is_a_refusal():
    os.environ["ISIBUKO_WEIGHTS"] = "/tmp/isibuko-weights-absent"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/status") as response:
            raise AssertionError(f"expected refusal, got {response.status}")
    except urllib.error.HTTPError as error:
        body = json.loads(error.read().decode())
        assert error.code == 409
        assert body["generated"] is False
        assert body["code"] == "WEIGHTS_MISSING"
    finally:
        httpd.shutdown()


def test_experiment_record_has_no_fake_metrics():
    os.environ["ISIBUKO_WEIGHTS"] = "/tmp/isibuko-weights-absent"
    record = server.experiment_record("sprint-1")
    assert record["generated"] is False
    assert record["outputPath"] is None
    assert record["metrics"] is None
    assert record["failureCode"] == "WEIGHTS_MISSING"


def test_input_paths_cannot_escape():
    os.environ["ISIBUKO_INPUTS"] = "/tmp/isibuko-inputs-gate"
    root = server.inputs_root()
    for unsafe in ("../etc/passwd", "/etc/passwd", ""):
        try:
            server.contained(root, unsafe)
        except ValueError:
            continue
        raise AssertionError(unsafe)


if __name__ == "__main__":
    test_missing_weights_do_not_generate()
    test_http_status_is_a_refusal()
    test_experiment_record_has_no_fake_metrics()
    test_input_paths_cannot_escape()
    print("infer service tests passed")

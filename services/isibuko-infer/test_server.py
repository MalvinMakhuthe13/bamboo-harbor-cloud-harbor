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


def test_nvidia_parser_is_refused_and_flat_lay_does_not_pretend_to_run():
    import parser_adapter

    blocked = parser_adapter.plan_parser("fashn-human-parser", True, "flat-lay")
    assert blocked["code"] == "PARSER_NON_COMMERCIAL"
    assert blocked["run"] is False
    assert blocked["usesNvidiaParser"] is True
    coarse = parser_adapter.plan_parser("mediapipe-selfie", True, "flat-lay")
    assert coarse["code"] == "INSUFFICIENT_LABELS"
    assert parser_adapter.plan_parser("sam2", True, "model")["code"] == "INSUFFICIENT_LABELS"
    masked = parser_adapter.plan_parser("none", False, "flat-lay")
    assert masked["code"] == "PARSER_REQUIRED"
    skipped = parser_adapter.plan_parser("none", True, "flat-lay")
    assert skipped["code"] == "PARSER_SKIPPED"
    assert skipped["run"] is True
    try:
        parser_adapter.register_parser({"id": "fashn-human-parser", "commercialCleared": True, "labelIds": parser_adapter.FASHN_LABEL_IDS})
    except parser_adapter.ParserLicenceError:
        pass
    else:
        raise AssertionError("nvidia parser was registered")
    assert parser_adapter.cleared_parsers() == []


def test_checkout_scan_rejects_a_parser_import():
    import tempfile
    from pathlib import Path

    import isolated_runner

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for rel in isolated_runner.REQUIRED:
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# apache module\n", encoding="utf-8")
        assert isolated_runner.inspect_checkout(root)["code"] == "CHECKOUT_PRESENT"
        dirty = root / "src/fashn_vton/utils/__init__.py"
        dirty.write_text("import fashn_human_parser\n", encoding="utf-8")
        assert isolated_runner.inspect_checkout(root)["code"] == "PARSER_IMPORT_IN_STACK"


def test_http_tryon_refuses_the_nvidia_parser_without_writing_an_image():
    os.environ["ISIBUKO_WEIGHTS"] = "/tmp/isibuko-weights-absent"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        payload = json.dumps(
            {
                "person": "person.png",
                "garment": "shirt.png",
                "category": "tops",
                "garmentPhotoType": "model",
                "segmentationFree": True,
                "parserId": "fashn-human-parser",
            }
        ).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/tryon",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(request)
            raise AssertionError("expected refusal")
        except urllib.error.HTTPError as error:
            body = json.loads(error.read().decode())
            assert error.code == 409
            assert body["generated"] is False
            assert body["image"] is None
            assert body["code"] == "PARSER_NON_COMMERCIAL"
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    test_missing_weights_do_not_generate()
    test_http_status_is_a_refusal()
    test_experiment_record_has_no_fake_metrics()
    test_input_paths_cannot_escape()
    test_nvidia_parser_is_refused_and_flat_lay_does_not_pretend_to_run()
    test_checkout_scan_rejects_a_parser_import()
    test_http_tryon_refuses_the_nvidia_parser_without_writing_an_image()
    print("infer service tests passed")

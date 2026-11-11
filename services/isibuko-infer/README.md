# Isibuko still-image inference gate

This process is the isolated place a real try-on model can run later.
It is not the live camera composite.

Today, with no weights installed, `GET /v1/status` and `POST /v1/tryon` return HTTP 409 and `generated: false`. They do not write an image.

## Run the refusal test

```bash
cd services/isibuko-infer
python3 test_server.py
```

## Run the service

```bash
cd services/isibuko-infer
ISIBUKO_WEIGHTS=/abs/path/to/weights python3 server.py
```

Weights are not in Git. Downloading the FASHN checkpoint (about 2 GB, plus the parser cache) is not approved. Do not set `ISIBUKO_ALLOW_FASHN=1` until that approval, a GPU decision, and a rights-cleared person/garment pair exist.

The live mirror must keep calling the on-device composite. This service is a separate path.

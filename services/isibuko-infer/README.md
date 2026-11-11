# Isibuko still-image inference gate

This process is the isolated place a real try-on model can run later.
It is not the live camera composite.

The stock FASHN pipeline imports a non-commercial human parser. This service does not.
A flat-lay garment with `segmentationFree: true` and `parserId: "none"` is the only route that may later call the try-on weights.
Until those weights, a CUDA GPU, and a rights-cleared pair exist, every response has `generated: false`.

## Run the refusal tests

```bash
cd services/isibuko-infer
python3 test_server.py
```

GPU commands, not yet approved and not run, are in `GPU_RUN.md`.

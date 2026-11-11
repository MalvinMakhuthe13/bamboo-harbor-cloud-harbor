"""Entry point used by the Kaggle notebook. A missing GPU exits 2."""

from kaggle_setup import main

if __name__ == "__main__":
    raise SystemExit(main())

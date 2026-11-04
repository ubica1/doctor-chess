# Stockfish 19 Lite Single

Unmodified JavaScript and WebAssembly from `stockfish@19.0.1`, Nathan Rugg / Chess.com / Stockfish contributors. Licensed under [GNU GPLv3](Copying.txt).

- `stockfish-19-lite-single.js` and matching `.wasm`: browser worker. One thread, embedded Lite NNUE; no cross-origin isolation or remote analysis service.
- `source-19.0.1.zip`: corresponding source and build scripts, upstream commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6` (tag `v19.0.1`).
- `nn-61e7af4bb97d.nnue`: the matching Lite network, retrieved from the official Stockfish network API. SHA-256 starts with `61e7af4bb97d`, as required by upstream.
- `manifest.json`: SHA-256 of every distributed upstream artifact, checked in the test suite.

To rebuild: extract the source ZIP, place the network in `src/`, install the Emscripten version documented by upstream (6.0.9), install the source package's development dependencies, and run `node build.js --single-threaded --lite -f`. Follow the complete upstream README in the ZIP for build prerequisites. The full-size neural network is unnecessary for this flavor.

Sources: [Stockfish.js](https://github.com/nmrugg/stockfish.js/tree/0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6), [Stockfish](https://github.com/official-stockfish/Stockfish), [Lite network](https://tests.stockfishchess.org/api/nn/nn-61e7af4bb97d.nnue).

The original GPL notices remain in the distributed files. Engine license/source downloads are also available from the application's footer. Doctor Chess communicates with the separate engine through UCI; application rules continue to validate every chosen move.

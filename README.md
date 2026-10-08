# Colectivos Córdoba

Webapp que dibuja los recorridos de colectivos de Córdoba Capital (Argentina) sobre un mapa y permite puntuarlos
de 1 a 6, con comentario y fotos.

- **Recorridos**: se descargan desde el navegador a OpenStreetMap (Overpass API, relaciones `route=bus`) y se guardan en caché 7 días.
- **Puntuaciones y fotos**: backend Node sin dependencias; guarda en `data/` (`ratings.json` y `data/uploads/`).

```
npm start     # http://localhost:3000
npm test
```
Variables: `PORT`, `DATA_DIR`.

> Los datos dependen de lo cargado en OSM; si falta una línea, se corrige en openstreetmap.org.
